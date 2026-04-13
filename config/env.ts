/**
 * config/env.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised environment configuration.
 *
 * Reads from process.env (loaded by dotenv in index.js) and exposes a
 * fully-typed `config` object so the rest of the codebase can import
 * values without touching process.env directly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';

export const config = {
  // ── Server ──────────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // ── JWT ─────────────────────────────────────────────────────────────────
  jwtSecret: process.env.JWT_SECRET || 'super-secret-local-dev-jwt-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // ── Shopify OAuth ───────────────────────────────────────────────────────
  shopifyApiKey: process.env.SHOPIFY_API_KEY || '',
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET || '',
  shopifyRedirectUri: process.env.SHOPIFY_REDIRECT_URI || 'http://localhost:3001/auth/shopify/callback',
  shopifyScopes: process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_orders',

  // ── Pinecone ────────────────────────────────────────────────────────────
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeIndexName: process.env.PINECONE_INDEX_NAME || 'ecommerce-index',

  // ── Gemini ──────────────────────────────────────────────────────────────
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // ── Database ────────────────────────────────────────────────────────────
  databaseUrl: process.env.DATABASE_URL || '',
} as const;
