/**
 * services/rag.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Production RAG pipeline — Pinecone + Gemini + PostgreSQL.
 *
 * Exports:
 *   • syncInventoryToPinecone()  — Step 2: Postgres → embed → Pinecone
 *   • getAgentResponse()         — Step 3: user query → vector search →
 *                                           DB enrich → Gemini answer
 *
 * SDK versions targeted:
 *   @pinecone-database/pinecone  ^7.x   (uses { records: [...] } upsert)
 *   @google/generative-ai        ^0.24  (embedContent with taskType)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { prisma } from '../lib/prisma';

import type {
  ProductVectorMetadata,
  EnrichedProduct,
  AgentResponse,
  SyncReport,
} from './rag.types';

// ── Client Singletons ────────────────────────────────────────────────────────

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY as string,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'ecommerce-index';
const pineconeIndex = pinecone.index<ProductVectorMetadata>(INDEX_NAME);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Helper to pause execution for a given number of milliseconds.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Embed a single text string via Gemini `gemini-embedding-001`.
 * Includes a simple retry mechanism for 429 (Rate Limit) errors.
 */
async function embedText(
  text: string,
  taskType: TaskType,
  retries = 3,
): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

  try {
    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType,
    });
    return result.embedding.values;
  } catch (error: any) {
    const status = error.status || error.response?.status;
    if (retries > 0 && status === 429) {
      const waitTime = 5000 * (4 - retries); // 5s, 10s, 15s...
      console.warn(`[RAG:Embedding] Rate limited (429). Retrying in ${waitTime}ms...`);
      await sleep(waitTime);
      return embedText(text, taskType, retries - 1);
    }
    throw error;
  }
}

/**
 * Embed multiple texts in one call via `batchEmbedContents`.
 * This is more efficient for staying within quota.
 */
async function embedBatch(
  texts: string[],
  taskType: TaskType,
  retries = 3,
): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

  try {
    const result = await model.batchEmbedContents({
      requests: texts.map((text) => ({
        content: { role: 'user', parts: [{ text }] },
        taskType,
      })),
    });

    return result.embeddings.map((e) => e.values);
  } catch (error: any) {
    const status = error.status || error.response?.status;
    if (retries > 0 && status === 429) {
      const waitTime = 10000 * (4 - retries); // 10s, 20s, 30s...
      console.warn(`[RAG:BatchEmbedding] Rate limited (429). Retrying batch in ${waitTime}ms...`);
      await sleep(waitTime);
      return embedBatch(texts, taskType, retries - 1);
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 2 — syncInventoryToPinecone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches every product variant from Postgres, embeds it with Gemini,
 * and upserts the resulting vectors + metadata into Pinecone.
 *
 * Uses the Postgres `variant.id` as the Pinecone vector id so we can
 * look the real row up again after a similarity search.
 */
export async function syncInventoryToPinecone(): Promise<SyncReport> {
  const start = Date.now();
  console.log('[RAG:Sync] Fetching inventory from PostgreSQL …');

  // 1. Pull all variants with their parent product data
  const variants = await prisma.productVariant.findMany({
    include: { product: true },
  });

  if (variants.length === 0) {
    console.log('[RAG:Sync] No variants found — nothing to sync.');
    return { totalVariants: 0, batchesUpserted: 0, durationMs: Date.now() - start };
  }

  console.log(`[RAG:Sync] Found ${variants.length} variant(s). Embedding …`);

  // 2. Process variants in chunks using batchEmbedContents
  const records = [];
  const EMBEDDING_CHUNK_SIZE = 30; // Processing 30 at a time via batch API
  
  console.log(`[RAG:Sync] Processing ${variants.length} variants in ${Math.ceil(variants.length / EMBEDDING_CHUNK_SIZE)} chunks...`);

  for (let i = 0; i < variants.length; i += EMBEDDING_CHUNK_SIZE) {
    const chunk = variants.slice(i, i + EMBEDDING_CHUNK_SIZE);
    
    const textsToEmbed = chunk.map(v => [
      `Title: ${v.product.title}`,
      `Category: ${v.product.category ?? 'N/A'}`,
      `Description: ${v.product.description ?? 'N/A'}`,
      `Color: ${v.color ?? 'N/A'}`,
      `Size: ${v.size ?? 'N/A'}`,
      `SKU: ${v.sku}`,
    ].join(', '));

    // Get all embeddings for this chunk in ONE API call
    const allValues = await embedBatch(textsToEmbed, TaskType.RETRIEVAL_DOCUMENT);

    const chunkRecords = chunk.map((v, index) => {
      return {
        id: String(v.id),
        values: allValues[index],
        metadata: {
          title: v.product.title,
          category: v.product.category ?? 'N/A',
          sku: v.sku,
          color: v.color ?? 'N/A',
          size: v.size ?? 'N/A',
          productId: v.product.id,
        } satisfies ProductVectorMetadata,
      };
    });

    records.push(...chunkRecords);
    
    // Progress update
    console.log(`[RAG:Sync] Embedded ${records.length} / ${variants.length} records...`);
    
    // Safety delay between batches (even with batch API, we need to respect RPM)
    if (i + EMBEDDING_CHUNK_SIZE < variants.length) {
      await sleep(3000); 
    }
  }

  // 3. Upsert in batches of 100 (Pinecone best practice)
  const BATCH_SIZE = 100;
  let batchesUpserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await pineconeIndex.upsert({ records: batch });
    batchesUpserted++;
    console.log(
      `[RAG:Sync] Upserted batch ${batchesUpserted} / ${Math.ceil(records.length / BATCH_SIZE)}`,
    );
  }

  const durationMs = Date.now() - start;
  console.log(`[RAG:Sync] ✅ Done — ${records.length} vectors in ${durationMs}ms`);

  return { totalVariants: records.length, batchesUpserted, durationMs };
}

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 3 — getAgentResponse
// ─────────────────────────────────────────────────────────────────────────────

/**
 * End-to-end RAG flow:
 *  1. Embed the user's question.
 *  2. Vector-search Pinecone for the top 3 matches.
 *  3. Enrich with real-time price + stock from Postgres.
 *  4. Pass everything to Gemini 1.5 Flash for a WhatsApp-style reply.
 */
export async function getAgentResponse(userMessage: string): Promise<AgentResponse> {
  try {
    // ── 1. Embed user query ────────────────────────────────────────────────
    console.log(`[RAG:Query] Embedding user message: "${userMessage.slice(0, 60)}…"`);
    const queryVector = await embedText(userMessage, TaskType.RETRIEVAL_QUERY);

    // ── 2. Pinecone similarity search ─────────────────────────────────────
    const searchResponse = await pineconeIndex.query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    const matchIds = searchResponse.matches.map((m) => m.id);

    if (matchIds.length === 0) {
      return {
        answer:
          "I couldn't find any products matching your request. Could you describe what you're looking for in a different way? 🤔",
        matchedProducts: [],
      };
    }

    console.log(`[RAG:Query] Pinecone returned IDs: [${matchIds.join(', ')}]`);

    // ── 3. Postgres enrichment (real-time price + stock) ──────────────────
    const variantIds = matchIds.map((id) => parseInt(id, 10));

    const enrichedRows = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });

    const matchedProducts: EnrichedProduct[] = enrichedRows.map((v) => ({
      variantId: v.id,
      productId: v.product.id,
      title: v.product.title,
      category: v.product.category ?? 'N/A',
      sku: v.sku,
      color: v.color ?? 'N/A',
      size: v.size ?? 'N/A',
      price: v.price.toString(),
      currentStock: v.currentStock,
      imageUrl: v.imageUrl ?? null,
    }));

    // Build a context block for the LLM
    const inventoryContext = matchedProducts
      .map(
        (p) =>
          `• ${p.title} — ${p.color}/${p.size} (SKU ${p.sku}): ₹${p.price}, ` +
          `${p.currentStock > 0 ? `${p.currentStock} in stock` : '❌ Out of Stock'}`,
      )
      .join('\n');

    // ── 4. Gemini 1.5 Flash — generate WhatsApp-style reply ──────────────
    const chatModel = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: [
        'You are a warm, helpful e-commerce shopping assistant chatting on WhatsApp.',
        'Respond conversationally using light emojis.',
        'If an item is out of stock, politely let the customer know and suggest alternatives from the list.',
        'Never invent products that are NOT in the provided inventory context.',
        'Keep responses concise — 3–4 sentences max.',
      ].join(' '),
    });

    const prompt = `
Customer question: "${userMessage}"

Real-time inventory matches from our database:
${inventoryContext}

Compose a natural, WhatsApp-friendly reply.`.trim();

    const geminiResponse = await chatModel.generateContent(prompt);
    const answer = geminiResponse.response.text();

    console.log(`[RAG:Query] Gemini reply generated (${answer.length} chars)`);

    return { answer, matchedProducts };
  } catch (error) {
    console.error('[RAG:Query] Error:', error);
    return {
      answer:
        "I'm sorry, I'm having trouble accessing the inventory right now. Please try again in a moment! 🙏",
      matchedProducts: [],
    };
  }
}
