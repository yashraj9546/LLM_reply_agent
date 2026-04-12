/**
 * services/rag.service.mock.js
 * ─────────────────────────────────────────────────────────────────────────────
 * MOCK implementation of the RAG pipeline.
 *
 * What it simulates:
 *   1. embedQuery()             → Returns a fake vector (no real Gemini call).
 *   2. retrieveProducts()       → Returns canned product fixtures (no Pinecone).
 *   3. generateGroundedResponse() → Returns a template-based answer (no LLM).
 *   4. runRag()                 → Orchestrates 1-3 end-to-end.
 *
 * SWAP STRATEGY:
 *   When real API keys are available, replace this file with the production
 *   `rag.service.ts` (or its compiled JS equivalent). The handler code that
 *   calls `ragPipeline.runRag()` remains 100% unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Mock Product Catalogue ────────────────────────────────────────────────────

/** Canned products that stand in for real Pinecone retrievals. */
const MOCK_PRODUCTS = [
  {
    id: 'prod_001',
    title: 'AirWave Pro Wireless Earbuds',
    description: 'Premium wireless earbuds with active noise cancellation, 30-hour battery, and IPX5 water resistance.',
    price: '49.99',
    currency: 'USD',
    imageUrl: 'https://example.com/images/airwave-pro.jpg',
    productUrl: 'https://example.com/products/airwave-pro',
    tags: 'electronics, audio, wireless, earbuds',
  },
  {
    id: 'prod_002',
    title: 'UltraFit Running Shoes',
    description: 'Lightweight running shoes with memory foam insoles and breathable mesh upper.',
    price: '89.99',
    currency: 'USD',
    imageUrl: 'https://example.com/images/ultrafit.jpg',
    productUrl: 'https://example.com/products/ultrafit-shoes',
    tags: 'footwear, running, sport, fitness',
  },
  {
    id: 'prod_003',
    title: 'NanoBlend Personal Blender',
    description: 'Compact 600W personal blender for smoothies, shakes, and soups. BPA-free, dishwasher safe.',
    price: '34.99',
    currency: 'USD',
    imageUrl: 'https://example.com/images/nanoblend.jpg',
    productUrl: 'https://example.com/products/nanoblend',
    tags: 'kitchen, blender, appliance, health',
  },
];

// ── Step 1: Mock Embedding ────────────────────────────────────────────────────

/**
 * Returns a deterministic fake embedding vector.
 * In production this calls Gemini text-embedding-004.
 *
 * @param {string} query
 * @returns {Promise<number[]>}
 */
async function embedQuery(query) {
  console.log(`[RAG:Mock] embedQuery("${query.slice(0, 50)}...")`);
  // Return a 768-dim vector of small random numbers (same dimensionality as production)
  return Array.from({ length: 768 }, () => Math.random() * 0.01);
}

// ── Step 2: Mock Retrieval ────────────────────────────────────────────────────

/**
 * Simulates a Pinecone top-3 query with simple keyword scoring.
 * In production this sends the vector to Pinecone.
 *
 * @param {number[]} _queryVector - Ignored in mock; keyword scoring used instead.
 * @param {string}   rawQuery     - Original text used for keyword matching.
 * @returns {Promise<object[]>}
 */
async function retrieveProducts(_queryVector, rawQuery = '') {
  const q = rawQuery.toLowerCase();

  // Score each product by counting keyword hits in its tags/title/description
  const scored = MOCK_PRODUCTS.map((p) => {
    const haystack = `${p.title} ${p.description} ${p.tags}`.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const hits = words.filter((w) => haystack.includes(w)).length;
    return { product: p, score: hits };
  });

  // Sort desc by score; fall back to returning all 3 if no keywords match
  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3).map((s) => s.product);

  console.log(`[RAG:Mock] retrieveProducts → [${top3.map((p) => p.title).join(', ')}]`);
  return top3;
}

// ── Step 3: Mock Generation ───────────────────────────────────────────────────

/**
 * Builds a template-based reply without calling any LLM.
 * In production this calls Gemini 1.5 Flash with a grounded system prompt.
 *
 * @param {string}   userMessage
 * @param {object[]} products
 * @returns {Promise<string>}
 */
async function generateGroundedResponse(userMessage, products) {
  if (products.length === 0) {
    return "I'm sorry, I couldn't find any matching products in our current inventory. Could you try rephrasing your question?";
  }

  const productLines = products
    .map((p, i) => `${i + 1}. *${p.title}* — ${p.price} ${p.currency}\n   ${p.description}`)
    .join('\n\n');

  const reply = [
    `👋 Great question! Based on what we have in stock, here are some options for you:\n`,
    productLines,
    `\nWould you like more details on any of these? Just let me know! 😊`,
    `\n⚠️ _[MOCK MODE — responses are simulated, not from a live AI]_`,
  ].join('\n');

  console.log('[RAG:Mock] generateGroundedResponse → template reply built');
  return reply;
}

// ── Public Pipeline ───────────────────────────────────────────────────────────

/**
 * End-to-end mock RAG pipeline.
 *
 * @param {string} whatsappMessage
 * @returns {Promise<{ answer: string, products: object[] }>}
 */
async function runRag(whatsappMessage) {
  const queryVector = await embedQuery(whatsappMessage);
  const products = await retrieveProducts(queryVector, whatsappMessage);
  const answer = await generateGroundedResponse(whatsappMessage, products);
  return { answer, products };
}

// ── Exports ───────────────────────────────────────────────────────────────────

const ragPipeline = { embedQuery, retrieveProducts, generateGroundedResponse, runRag };
module.exports = { ragPipeline };
