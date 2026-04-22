/**
 * Consensus scraper worker host (Phase 1c.2a).
 *
 * Listens on the `macro-consensus-scrape` queue. Every 30 min, a
 * repeatable cron job lands. Processor:
 *   1. Reads upcoming MacroRelease rows (next 4h) OR rows missing
 *      consensus within the past 24h
 *   2. For each indicator, calls runConsensusScrapeForIndicator which
 *      tries Investing.com → Trading Economics → writes CostLog heartbeat
 *   3. Per-indicator failure doesn't block the batch (heartbeat records it)
 *
 * Invocation (local):
 *   npx tsx --tsconfig pipeline-service/tsconfig.json pipeline-service/consensus-scraper-worker.ts
 */

import 'dotenv/config'
import type { Worker } from 'bullmq'
import { QUEUE_NAMES } from '../src/lib/queue/names'
import { createWorker } from '../src/lib/queue/workers'
import { getQueue } from '../src/lib/queue/queues'
import { closeRedisConnection } from '../src/lib/queue/connection'
import { prisma } from '../src/lib/db'
import { runConsensusScrapeForIndicator } from '../src/lib/macro/consensus/scrape-runner'
import { scrapeableIndicators } from '../src/lib/macro/consensus/indicator-slug-map'

const workers: Worker[] = []
let shuttingDown = false

async function start() {
  const worker = createWorker(
    QUEUE_NAMES.MACRO_CONSENSUS_SCRAPE,
    async (job) => {
      console.log(`[consensus-scraper] job ${job.id} starting`)
      const indicators = scrapeableIndicators()
      const results = []
      // Sequential, not parallel — HTML scrapers are rate-sensitive.
      for (const indicator of indicators) {
        const r = await runConsensusScrapeForIndicator(prisma, indicator)
        results.push(r)
      }
      const upserted = results.filter((r) => r.status === 'upserted').length
      const no_data = results.filter((r) => r.status === 'no_data').length
      const errors = results.filter((r) => r.status === 'error').length
      console.log(
        `[consensus-scraper] job ${job.id} done: upserted=${upserted} no_data=${no_data} errors=${errors}`,
      )
      return { upserted, no_data, errors }
    },
    { concurrency: 1 },
  )
  workers.push(worker)
  console.log('[consensus-scraper-worker] 1 worker registered')

  // Register repeatable scheduler — every 30 minutes
  const queue = getQueue(QUEUE_NAMES.MACRO_CONSENSUS_SCRAPE)
  await queue.upsertJobScheduler(
    'consensus-scrape-tick',
    { every: 30 * 60 * 1000 },
    { name: 'scrape', data: {} },
  )
  console.log('[consensus-scraper-worker] repeatable scheduler registered')
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[consensus-scraper-worker] ${signal} received`)
  await Promise.all(
    workers.map(async (w) => {
      try {
        await w.close()
      } catch (err) {
        console.error(`[consensus-scraper-worker:${w.name}] close error:`, err)
      }
    }),
  )
  await closeRedisConnection()
  await prisma.$disconnect()
  console.log('[consensus-scraper-worker] shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((err) => {
  console.error('[consensus-scraper-worker] startup failed:', err)
  process.exit(1)
})
