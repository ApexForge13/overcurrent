/**
 * Idempotent entity registry seed.
 *
 * Runs all four sources (SEC, CoinGecko, futures, ETFs) and upserts into
 * TrackedEntity. Safe to re-run — existing entities update, new ones insert.
 *
 * Usage:
 *   npx tsx scripts/seed-entities.ts              (all sources, live fetches)
 *   npx tsx scripts/seed-entities.ts --dry-run    (no DB writes)
 *   npx tsx scripts/seed-entities.ts --only=sec   (single source)
 *
 * Phase 1b: this script is NOT run automatically. Invoke manually after the
 * migration lands on a target database.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { loadEntityRegistry } from '../src/lib/entities/registry'
import type { TrackedEntityInput } from '../src/lib/entities/types'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyArg = args.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null

async function main() {
  console.log(`[seed-entities] starting ${dryRun ? '(dry-run)' : ''}`)
  const registryOpts = {
    sec:        only && !only.includes('sec') ? (false as const) : {},
    coingecko:  only && !only.includes('coingecko') ? (false as const) : {},
    futures:    only ? only.includes('futures') : true,
    etfs:       only ? only.includes('etfs') : true,
    onProgress: (ev: { source: string; status: string } & Record<string, unknown>) => {
      if (ev.status === 'started') console.log(`[seed-entities] ${ev.source} starting...`)
      else if (ev.status === 'success') console.log(`[seed-entities] ${ev.source}: ${(ev as { count: number }).count} entities`)
      else if (ev.status === 'skipped') console.log(`[seed-entities] ${ev.source}: skipped (${(ev as { reason: string }).reason})`)
      else if (ev.status === 'failed')  console.error(`[seed-entities] ${ev.source}: FAILED — ${(ev as { error: string }).error}`)
    },
  }
  const { entities, bySource, duplicatesOverridden } = await loadEntityRegistry(registryOpts)
  console.log(`[seed-entities] aggregated ${entities.length} unique entities (${duplicatesOverridden} duplicates overridden)`)
  console.log(`[seed-entities] breakdown by source:`, bySource)

  if (dryRun) {
    console.log('[seed-entities] dry-run — no DB writes.')
    return
  }

  const BATCH_SIZE = 100
  let upserted = 0
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(upsertEntity))
    upserted += batch.length
    if (upserted % 1000 === 0 || upserted === entities.length) {
      console.log(`[seed-entities] upserted ${upserted}/${entities.length}`)
    }
  }
  console.log(`[seed-entities] done — ${upserted} entities in TrackedEntity`)
}

async function upsertEntity(input: TrackedEntityInput) {
  await prisma.trackedEntity.upsert({
    where: { identifier: input.identifier },
    create: {
      identifier: input.identifier,
      name: input.name,
      category: input.category,
      subcategory: input.subcategory,
      providerIds: input.providerIds as object,
      groundTruthMap: input.groundTruthMap as object,
      entityStrings: input.entityStrings as object,
      isFeatured: input.isFeatured ?? false,
      active: true,
    },
    update: {
      name: input.name,
      category: input.category,
      subcategory: input.subcategory,
      providerIds: input.providerIds as object,
      groundTruthMap: input.groundTruthMap as object,
      entityStrings: input.entityStrings as object,
    },
  })
}

main()
  .catch((err) => {
    console.error('[seed-entities] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
