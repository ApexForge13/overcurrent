/**
 * Candidate generator worker host (Phase 1c.1).
 *
 * Listens on the `candidate-generator` queue. Every 15 min, a repeatable
 * cron job lands → processor calls `generateCandidates()` → that function
 * reads TriggerEvent rows, aggregates by entity, enqueues gap-score-
 * candidate-compute jobs for qualifying entities.
 *
 * Also listens on `trigger-scan` queue: when a scheduled trigger job lands,
 * the processor dispatches the registered trigger implementations and
 * writes TriggerEvent rows.
 *
 * Separate entry point from pipeline-service/worker.ts so the trigger
 * scanning + candidate generation can be scaled independently. Deploy
 * both on Railway when Phase 2 lands real processors.
 *
 * Invocation (local):
 *   npx tsx --tsconfig pipeline-service/tsconfig.json pipeline-service/candidate-generator-worker.ts
 */

import 'dotenv/config'
import type { Worker } from 'bullmq'
import { QUEUE_NAMES } from '../src/lib/queue/names'
import { createWorker } from '../src/lib/queue/workers'
import { getQueue } from '../src/lib/queue/queues'
import { closeRedisConnection } from '../src/lib/queue/connection'
import { prisma } from '../src/lib/db'
import { generateCandidates } from '../src/lib/gap-score/candidate-generator'
import { TRIGGER_DEFINITIONS } from '../src/lib/gap-score/triggers/registry'
import { dispatchTrigger } from '../src/lib/gap-score/triggers/dispatch'
import type { TriggerFunction } from '../src/lib/gap-score/triggers/types'
import { multiStreamConfluenceTrigger } from '../src/lib/gap-score/triggers/meta/multi-stream-confluence'
import { featuredSetBaselineTrigger } from '../src/lib/gap-score/triggers/meta/featured-set-baseline'
import { macroSurpriseTrigger } from '../src/lib/gap-score/triggers/ground-truth/macro-surprise'
import { secForm4Trigger } from '../src/lib/gap-score/triggers/ground-truth/sec-form-4'
import { sec13DGTrigger } from '../src/lib/gap-score/triggers/ground-truth/sec-13d-g'
import { sec8KTrigger } from '../src/lib/gap-score/triggers/ground-truth/sec-8-k'
import { congressionalTradeTrigger } from '../src/lib/gap-score/triggers/ground-truth/congressional-trade'
import { cftcManagedMoneyTrigger } from '../src/lib/gap-score/triggers/ground-truth/cftc-managed-money'
// Narrative (Phase 1c.2b.1)
import { articleVolumeSpikeTrigger } from '../src/lib/gap-score/triggers/narrative/article-volume-spike'
import { crossOutletTrigger } from '../src/lib/gap-score/triggers/narrative/cross-outlet'
import { wireHeadlineTrigger } from '../src/lib/gap-score/triggers/narrative/wire-headline'
import { sentimentExtremityBatchTrigger } from '../src/lib/gap-score/triggers/narrative/sentiment-extremity-batch'
// Psychological (Phase 1c.2b.1)
import { cashtagVelocityTrigger } from '../src/lib/gap-score/triggers/psychological/cashtag-velocity'
import { engagementVelocityTrigger } from '../src/lib/gap-score/triggers/psychological/engagement-velocity'
import { crossPlatformAmplificationTrigger } from '../src/lib/gap-score/triggers/psychological/cross-platform-amplification'
import { sentimentExtremityConsensusTrigger } from '../src/lib/gap-score/triggers/psychological/sentiment-extremity-consensus'

const TRIGGER_IMPLEMENTATIONS: Record<string, TriggerFunction> = {
  // Meta
  'T-META1': multiStreamConfluenceTrigger,
  'T-META2': featuredSetBaselineTrigger,
  // Ground truth
  'T-GT1': secForm4Trigger,
  'T-GT2': sec13DGTrigger,
  'T-GT3': sec8KTrigger,
  'T-GT4': cftcManagedMoneyTrigger,
  'T-GT9': macroSurpriseTrigger,
  'T-GT10': congressionalTradeTrigger,
  // Narrative
  'T-N1': articleVolumeSpikeTrigger,
  'T-N2': crossOutletTrigger,
  'T-N3': wireHeadlineTrigger,
  'T-N4': sentimentExtremityBatchTrigger,
  // Psychological
  'T-P1': cashtagVelocityTrigger,
  'T-P2': engagementVelocityTrigger,
  'T-P3': crossPlatformAmplificationTrigger,
  'T-P4': sentimentExtremityConsensusTrigger,
}

const workers: Worker[] = []
let shuttingDown = false

async function start() {
  // ── Candidate generator worker ──
  const candidateWorker = createWorker(
    QUEUE_NAMES.CANDIDATE_GENERATOR,
    async (job) => {
      console.log(`[candidate-generator] job ${job.id} starting`)
      const result = await generateCandidates(prisma)
      console.log(`[candidate-generator] job ${job.id} done:`, result)
      return result
    },
    { concurrency: 1 },
  )
  workers.push(candidateWorker)

  // ── Trigger scan worker ──
  const triggerWorker = createWorker(
    QUEUE_NAMES.TRIGGER_SCAN,
    async (job) => {
      const triggerId = (job.data as { triggerId?: string })?.triggerId
      if (!triggerId) throw new Error('trigger-scan job missing triggerId')
      const def = TRIGGER_DEFINITIONS[triggerId]
      const impl = TRIGGER_IMPLEMENTATIONS[triggerId]
      if (!def || !impl) throw new Error(`unknown triggerId: ${triggerId}`)
      const result = await dispatchTrigger(def, impl, { prisma, now: new Date() })
      console.log(`[trigger-scan] ${triggerId}:`, result)
      return result
    },
    { concurrency: 3 },
  )
  workers.push(triggerWorker)

  console.log(`[candidate-generator-worker] ${workers.length} workers registered`)

  // ── Register repeatable schedules ──
  await registerRepeatables()
}

async function registerRepeatables() {
  const candidateQueue = getQueue(QUEUE_NAMES.CANDIDATE_GENERATOR)
  // Candidate generator tick every 15 min
  await candidateQueue.upsertJobScheduler(
    'candidate-generator-tick',
    { every: 15 * 60 * 1000 },
    { name: 'generate', data: {} },
  )

  const triggerQueue = getQueue(QUEUE_NAMES.TRIGGER_SCAN)
  // Meta triggers every 15 min (same cadence as candidate generator — fires first, generator consumes)
  await triggerQueue.upsertJobScheduler(
    't-meta1-scan',
    { every: 15 * 60 * 1000 },
    { name: 'scan', data: { triggerId: 'T-META1' } },
  )
  // Featured baseline every 3h
  await triggerQueue.upsertJobScheduler(
    't-meta2-scan',
    { every: 3 * 60 * 60 * 1000 },
    { name: 'scan', data: { triggerId: 'T-META2' } },
  )
  // Macro surprise every 30 min
  await triggerQueue.upsertJobScheduler(
    't-gt9-scan',
    { every: 30 * 60 * 1000 },
    { name: 'scan', data: { triggerId: 'T-GT9' } },
  )
  // SEC triggers every 30 min (stubs in 1c.1, wired for 1c.2)
  for (const id of ['T-GT1', 'T-GT2', 'T-GT3'] as const) {
    await triggerQueue.upsertJobScheduler(
      `${id.toLowerCase()}-scan`,
      { every: 30 * 60 * 1000 },
      { name: 'scan', data: { triggerId: id } },
    )
  }
  // Congressional trade every 6h
  await triggerQueue.upsertJobScheduler(
    't-gt10-scan',
    { every: 6 * 60 * 60 * 1000 },
    { name: 'scan', data: { triggerId: 'T-GT10' } },
  )
  // CFTC COT every 6h (weekly report; frequent cadence catches the Fri
  // release within a few hours without busy-polling)
  await triggerQueue.upsertJobScheduler(
    't-gt4-scan',
    { every: 6 * 60 * 60 * 1000 },
    { name: 'scan', data: { triggerId: 'T-GT4' } },
  )

  // ── Narrative triggers (Phase 1c.2b.1) — every 5 min ──
  for (const id of ['T-N1', 'T-N2', 'T-N3', 'T-N4'] as const) {
    await triggerQueue.upsertJobScheduler(
      `${id.toLowerCase()}-scan`,
      { every: 5 * 60 * 1000 },
      { name: 'scan', data: { triggerId: id } },
    )
  }
  // ── Psychological triggers (Phase 1c.2b.1) — every 5 min ──
  for (const id of ['T-P1', 'T-P2', 'T-P3', 'T-P4'] as const) {
    await triggerQueue.upsertJobScheduler(
      `${id.toLowerCase()}-scan`,
      { every: 5 * 60 * 1000 },
      { name: 'scan', data: { triggerId: id } },
    )
  }

  console.log('[candidate-generator-worker] repeatable schedulers registered')
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[candidate-generator-worker] ${signal} received`)
  await Promise.all(
    workers.map(async (w) => {
      try {
        await w.close()
      } catch (err) {
        console.error(`[candidate-generator-worker:${w.name}] close error:`, err)
      }
    }),
  )
  await closeRedisConnection()
  await prisma.$disconnect()
  console.log('[candidate-generator-worker] shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((err) => {
  console.error('[candidate-generator-worker] startup failed:', err)
  process.exit(1)
})
