/**
 * services/rag.types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared TypeScript interfaces for the RAG pipeline.
 *
 * Keeping types in a separate file lets both the mock and production
 * implementations share the same contract without importing each other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Pinecone Metadata ────────────────────────────────────────────────────────

/** Metadata stored alongside each vector in Pinecone. */
export interface ProductVectorMetadata {
  [key: string]: string | boolean | number | string[];
  title: string;
  category: string;
  sku: string;
  color: string;
  size: string;
  productId: number;
}

// ── Enriched Product (after Postgres lookup) ─────────────────────────────────

/** A variant record enriched with real-time inventory data from Postgres. */
export interface EnrichedProduct {
  variantId: number;
  productId: number;
  title: string;
  category: string;
  sku: string;
  color: string;
  size: string;
  price: string;
  currentStock: number;
  imageUrl: string | null;
}

// ── Agent Response ───────────────────────────────────────────────────────────

/** The shape returned by the public `getAgentResponse` function. */
export interface AgentResponse {
  answer: string;
  matchedProducts: EnrichedProduct[];
}

// ── Sync Report ──────────────────────────────────────────────────────────────

/** Summary returned after a full inventory sync. */
export interface SyncReport {
  totalVariants: number;
  batchesUpserted: number;
  durationMs: number;
}
