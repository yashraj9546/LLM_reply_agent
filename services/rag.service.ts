// services/rag.service.ts
import { Pinecone, PineconeRecord } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../lib/prisma'; // Using Prisma client for DB queries

// 1. Initialize API Clients
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY as string,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Target Pinecone Index
const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME || 'ecommerce-index');

/**
 * Step 2: Inventory Sync Logic (Postgres -> Pinecone)
 * Fetches all products/variants via Prisma, embeds them via Gemini, and upserts to Pinecone.
 */
export async function syncInventoryToPinecone() {
  try {
    console.log('Fetching inventory from PostgreSQL...');
    
    // 1. Fetch products and variations using the new Prisma models
    const variants = await prisma.productVariant.findMany({
      include: {
        product: true
      }
    });

    if (!variants || variants.length === 0) {
      console.log('No products found to sync.');
      return;
    }

    // Reference to embedding model
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    console.log('Preparing vectors for Pinecone...');

    // 2. Prepare vectors mapping
    const vectors: PineconeRecord[] = await Promise.all(variants.map(async (variant) => {
      // Build an embedding string capturing essential context
      const textToEmbed = `Title: ${variant.product.title}, Category: ${variant.product.category || 'N/A'}, Description: ${variant.product.description || 'N/A'}`;
      
      // Request embedding
      const embeddingResult = await embeddingModel.embedContent(textToEmbed);
      const values = embeddingResult.embedding.values;

      // 3. Construct Vector object strictly adhering to PineconeRecord type
      return {
        id: String(variant.id), // Crucial: Using variant.id as Pinecone ID
        values,
        metadata: {
          title: variant.product.title,
          category: variant.product.category || 'N/A',
        }
      };
    }));

    // 4. Upsert batches into Pinecone
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      // Casting to any to bypass Pinecone TS SDK overload resolution issue with arrays
      await pineconeIndex.upsert(batch as any);
      console.log(`Upserted batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(vectors.length / batchSize)}`);
    }

    console.log('Successfully synced inventory to Pinecone!');
  } catch (error) {
    console.error('Error syncing inventory to Pinecone:', error);
    throw error;
  }
}

/**
 * Step 3: The Query & Retrieval Flow
 * Handles user questions, queries vector database, enriches with Postgres, generates natural response.
 */
export async function getAgentResponse(userMessage: string): Promise<string> {
  try {
    // 1. Embed User Input
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const userEmbeddingResult = await embeddingModel.embedContent(userMessage);
    const userVector = userEmbeddingResult.embedding.values;

    // 2. Pinecone Query
    const searchResponse = await pineconeIndex.query({
      vector: userVector,
      topK: 3,
      includeMetadata: false, // Not strictly needed because we enrich below
    });

    const matchIds = searchResponse.matches.map(match => match.id);

    if (matchIds.length === 0) {
      return "I couldn't find any products matching your request. Could you specify further?";
    }

    // Convert string IDs from Pinecone back to numbers for Prisma
    const variantIds = matchIds.map(id => parseInt(id, 10));

    // 3. Postgres Enrichment using Prisma
    const inventoryResult = await prisma.productVariant.findMany({
      where: {
        id: { in: variantIds }
      },
      include: {
        product: true
      }
    });

    // Build context block
    const inventoryContext = inventoryResult.map((variant) => 
      `- ${variant.product.title} (Category: ${variant.product.category || 'N/A'}): Price $${variant.price.toString()}. Stock: ${variant.currentStock > 0 ? variant.currentStock : 'Out of Stock'}`
    ).join('\n');

    // 4. Gemini Final Response
    const generativeModel = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: 'You are a warm, helpful online e-commerce agent chatting on WhatsApp. Always provide responses that are conversational, formatting with a touch of appropriate emojis. If items are out of stock, politely inform the user.'
    });
    
    // Pass original question + verified database context to Gemini
    const finalPrompt = `
A customer has asked the following question: "${userMessage}"

Here are the most relevant products strictly matched from our current real-time database to ground your answer:
${inventoryContext}

Please form a natural response. Instead of rendering rigid lists, include the matched product prices implicitly in a flowing sentence if possible.
    `;

    const chatResponse = await generativeModel.generateContent(finalPrompt);
    return chatResponse.response.text();
    
  } catch (error) {
    console.error('Error generating agent response:', error);
    return "I'm sorry, I'm having trouble accessing the inventory right now. Please try again in a moment!";
  }
}
