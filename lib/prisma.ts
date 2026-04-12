/**
 * lib/prisma.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Prisma Client singleton.
 *
 * Why a singleton?
 *   In development, Node module hot-reloading (ts-node --watch / nodemon) can
 *   create a new PrismaClient on every reload, exhausting the DB connection
 *   pool quickly. The global trick below ensures only ONE instance is ever
 *   created per process lifetime.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';

// Extend the Node.js global type so TypeScript accepts the cached property.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
