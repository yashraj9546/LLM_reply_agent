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
 * Embed a single text string via Gemini `text-embedding-004`.
 *
 * @param text     — The text to embed.
 * @param taskType — Improves quality: use `RETRIEVAL_DOCUMENT` when indexing,
 *                   `RETRIEVAL_QUERY` when searching.
 */
async function embedText(
  text: string,
  taskType: TaskType,
): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text }] },
    taskType,
  });

  return result.embedding.values;
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

  // 2. Build embedding text and generate vectors
  const records = await Promise.all(
    variants.map(async (v) => {
      const textToEmbed = [
        `Title: ${v.product.title}`,
        `Category: ${v.product.category ?? 'N/A'}`,
        `Description: ${v.product.description ?? 'N/A'}`,
        `Color: ${v.color ?? 'N/A'}`,
        `Size: ${v.size ?? 'N/A'}`,
        `SKU: ${v.sku}`,
      ].join(', ');

      const values = await embedText(textToEmbed, TaskType.RETRIEVAL_DOCUMENT);

      return {
        id: String(v.id), // Crucial: variant PK → Pinecone id
        values,
        metadata: {
          title: v.product.title,
          category: v.product.category ?? 'N/A',
          sku: v.sku,
          color: v.color ?? 'N/A',
          size: v.size ?? 'N/A',
          productId: v.product.id,
        } satisfies ProductVectorMetadata,
      };
    }),
  );

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
