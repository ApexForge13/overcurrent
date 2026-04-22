/**
 * Worker host (Phase 1a — scaffold only).
 *
 * Boots one BullMQ Worker per queue name with a placeholder processor that
 * log-and-drops every job with `{ placeholder: true }`. Real processors land
 * in Phase 1b+ alongside the Gap Score and paper-trading logic.
 *
 * Invocation:
 *   npx tsx --tsconfig pipeline-service/tsconfig.json pipeline-service/worker.ts
 *
 * Railway does NOT run this yet — the server (pipeline-service/server.ts)
 * remains the only entry point. When processors exist, we decide whether
 * workers run in a separate Railway service or combined with the server.
 *
 * Graceful shutdown on SIGTERM (Railway sends this on redeploy) and SIGINT
 * (local Ctrl-C): closes every worker (waits for in-flight jobs to finish),
 * then closes the shared Redis connection, then exits 0.
 *
 * If startup fails, exits 1 so a process supervisor (pm2, Railway) can
 * restart rather than silently sit in a broken state.
 */

import 'dotenv/config'
import type { Worker, Processor } from 'bullmq'
import { QUEUE_NAMES, type QueueName } from '../src/lib/queue/names'
import { createWorker } from '../src/lib/queue/workers'
import { closeRedisConnection } from '../src/lib/queue/connection'

// Per-queue concurrency — values committed in Phase 1a manifest §6 +
// Phase 1c candidate-generator and trigger-scan additions.
const CONCURRENCY: Record<QueueName, number> = {
  [QUEUE_NAMES.GAP_SCORE_FEATURED_BASELINE]: 3,
  [QUEUE_NAMES.GAP_SCORE_CANDIDATE_COMPUTE]: 10,
  [QUEUE_NAMES.GAP_SCORE_BACKFILL]: 2,
  [QUEUE_NAMES.GAP_SCORE_BASELINE_COMPUTE]: 1, // single-runner hourly cron
  [QUEUE_NAMES.CANDIDATE_GENERATOR]: 1, // single-runner cron, no concurrency
  [QUEUE_NAMES.TRIGGER_SCAN]: 3, // parallel trigger scans (e.g., SEC + Congress + Macro)
  [QUEUE_NAMES.MACRO_CONSENSUS_SCRAPE]: 1, // sequential — HTML scrapers rate-sensitive
  [QUEUE_NAMES.NARRATIVE_INGEST]: 2, // GDELT + RSS pollers run in parallel
  [QUEUE_NAMES.PSYCH_INGEST]: 2, // Reddit + Twitter pollers run in parallel
  [QUEUE_NAMES.PAPER_TRADING_STRATEGY_GENERATE]: 5,
  [QUEUE_NAMES.PAPER_TRADING_EXECUTE]: 3,
  [QUEUE_NAMES.PAPER_TRADING_MONITOR_POSITIONS]: 1,
  [QUEUE_NAMES.PAPER_TRADING_AGGREGATE_PERFORMANCE]: 1,
}

function makePlaceholderProcessor(queueName: QueueName): Processor<unknown, { placeholder: true; processedAt: string }> {
  return async (job) => {
    console.log(
      `[worker:${queueName}] placeholder job ${job.id} (data dropped — Phase 1a scaffold, no processor wired yet)`,
    )
    return { placeholder: true, processedAt: new Date().toISOString() }
  }
}

const workers: Worker[] = []
let shuttingDown = false

async function start() {
  console.log(`[worker] starting host — ${Object.keys(CONCURRENCY).length} queues`)
  for (const name of Object.values(QUEUE_NAMES)) {
    const concurrency = CONCURRENCY[name]
    const w = createWorker(name, makePlaceholderProcessor(name), { concurrency })
    w.on('ready', () => console.log(`[worker:${name}] ready (concurrency=${concurrency})`))
    w.on('error', (err) => console.error(`[worker:${name}] error:`, err.message))
    w.on('failed', (job, err) =>
      console.error(`[worker:${name}] job ${job?.id} failed:`, err.message),
    )
    workers.push(w)
  }
  console.log(`[worker] ${workers.length} workers registered, awaiting jobs`)
}

async function shutdown(signal: string) {
  if (shuttingDown) return // idempotent on repeat signals
  shuttingDown = true
  console.log(`[worker] ${signal} received — draining ${workers.length} workers`)
  await Promise.all(
    workers.map(async (w) => {
      try {
        await w.close()
      } catch (err) {
        console.error(`[worker:${w.name}] error during close:`, err)
      }
    }),
  )
  await closeRedisConnection()
  console.log('[worker] shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((err) => {
  console.error('[worker] startup failed:', err)
  process.exit(1)
})
