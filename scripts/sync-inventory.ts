/**
 * scripts/sync-inventory.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CLI runner — syncs your entire PostgreSQL inventory into Pinecone.
 *
 * Usage:
 *   npx tsx scripts/sync-inventory.ts
 *
 * Requires .env to be populated with:
 *   DATABASE_URL, PINECONE_API_KEY, PINECONE_INDEX_NAME, GEMINI_API_KEY
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import { syncInventoryToPinecone } from '../services/rag.service';

async function main() {
  console.log('\n🔄  Starting inventory sync …\n');

  try {
    const report = await syncInventoryToPinecone();

    console.log('\n╔══════════════════════════════════════╗');
    console.log('║       Sync completed successfully    ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  Variants synced : ${String(report.totalVariants).padStart(6)}           ║`);
    console.log(`║  Batches upserted: ${String(report.batchesUpserted).padStart(6)}           ║`);
    console.log(`║  Duration        : ${String(report.durationMs).padStart(6)} ms        ║`);
    console.log('╚══════════════════════════════════════╝\n');
  } catch (error) {
    console.error('❌  Sync failed:', error);
    process.exit(1);
  }
}

main();
