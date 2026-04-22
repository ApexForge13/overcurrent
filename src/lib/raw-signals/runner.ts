/**
 * Raw signal queue runner.
 *
 * Picks up pending RawSignalQueue records, dispatches to the right
 * integration, writes the result to RawSignalLayer, and updates the queue
 * row's status.
 *
 * Design rules:
 *   - Every integration must fail gracefully. On error, set status='failed'
 *     + errorMessage. Never throw up to the caller (except programmer errors).
 *   - PACER integrations (signalType='legal_pacer') require approvedByAdmin=true
 *     — we double-check at call site AND at the top of the runner.
 *   - Admin-only. Never returns data to public-facing routes.
 *
 * Phase 1c.2a: accepts BOTH cluster-scoped (legacy pipeline) and entity-
 * scoped (trigger pipeline) queue rows. Exactly one of storyClusterId or
 * entityId must be set on the queue row. Cluster-scoped rows populate
 * ctx.cluster; entity-scoped rows populate ctx.entity. Adapters that only
 * make sense in one mode should check which is populated and return null
 * (skipped) if invoked in the wrong mode.
 */

import { prisma } from '@/lib/db'
import type { SignalType } from './types'

export interface RunnerEntityContext {
  id: string
  identifier: string
  name: string
  category: string
  aliases: string[]
}

export interface RunnerClusterData {
  id: string
  headline: string
  synopsis: string
  firstDetectedAt: Date
  entities: string[]
  signalCategory: string | null
}

interface BaseRunnerContext {
  queueId: string
  umbrellaArcId: string | null
  signalType: SignalType
  triggerLayer: string
  triggerReason: string
  approvedByAdmin: boolean
}

/**
 * Cluster-scoped runner context — legacy debate pipeline adapters.
 * Adapters that only work in cluster mode narrow with:
 *   if (ctx.scope !== 'cluster') return null
 * TS then treats `ctx.cluster` as non-null throughout the function.
 */
export interface ClusterRunnerContext extends BaseRunnerContext {
  scope: 'cluster'
  storyClusterId: string
  entityId: null
  cluster: RunnerClusterData
  entity: null
}

/**
 * Entity-scoped runner context — Phase 1c.2a trigger pipeline.
 * Adapters that only work in entity mode narrow with:
 *   if (ctx.scope !== 'entity') return null
 */
export interface EntityRunnerContext extends BaseRunnerContext {
  scope: 'entity'
  storyClusterId: null
  entityId: string
  cluster: null
  entity: RunnerEntityContext
}

export type RunnerContext = ClusterRunnerContext | EntityRunnerContext

// Return value of every integration runner
export interface IntegrationResult {
  /** Write to RawSignalLayer.rawContent */
  rawContent: Record<string, unknown>
  /** Haiku-generated summary to store */
  haikuSummary: string
  /** Signal source identifier (e.g. "sentinel-hub", "opensky") */
  signalSource: string
  /** When the signal was captured (may predate the query) */
  captureDate: Date
  /** Bounding box used for the query (or null) */
  coordinates: { swLat: number; swLng: number; neLat: number; neLng: number } | null
  divergenceFlag: boolean
  divergenceDescription: string | null
  confidenceLevel: 'low' | 'medium' | 'high' | 'unavailable'
}

// Registry — integrations register themselves here
export type IntegrationRunner = (ctx: RunnerContext) => Promise<IntegrationResult | null>

const REGISTRY: Partial<Record<SignalType, IntegrationRunner>> = {}

export function registerIntegration(signalType: SignalType, runner: IntegrationRunner): void {
  REGISTRY[signalType] = runner
}

export function getRegisteredSignalTypes(): SignalType[] {
  return Object.keys(REGISTRY) as SignalType[]
}

/**
 * Process a single queue entry by id. Idempotent — safe to call with any
 * queue id regardless of status; no-ops if the status isn't 'pending' or
 * 'requires_approval' with approvedByAdmin=true.
 */
export async function processQueueEntry(queueId: string): Promise<void> {
  const entry = await prisma.rawSignalQueue.findUnique({
    where: { id: queueId },
  })
  if (!entry) {
    console.warn(`[raw-signals/runner] Queue entry ${queueId} not found`)
    return
  }

  // Status gating
  if (entry.status === 'running' || entry.status === 'completed' || entry.status === 'skipped' || entry.status === 'failed') {
    return // no-op
  }
  if (entry.status === 'requires_approval' && !entry.approvedByAdmin) {
    return // gated; wait for admin
  }

  // PACER hard safeguard — NEVER run without explicit admin approval.
  if (entry.signalType === 'legal_pacer' && !entry.approvedByAdmin) {
    console.warn(
      `[raw-signals/runner] BLOCKED: legal_pacer queue ${queueId} without approvedByAdmin`,
    )
    await prisma.rawSignalQueue.update({
      where: { id: queueId },
      data: {
        status: 'failed',
        errorMessage: 'PACER blocked: approvedByAdmin was false at runtime',
      },
    })
    return
  }

  const runner = REGISTRY[entry.signalType as SignalType]
  if (!runner) {
    await prisma.rawSignalQueue.update({
      where: { id: queueId },
      data: {
        status: 'skipped',
        errorMessage: `No runner registered for signalType=${entry.signalType}`,
      },
    })
    return
  }

  // Enforce the runner invariant: exactly one of (storyClusterId, entityId)
  // must be present. Both-null rows are a programmer error from whoever
  // enqueued the job; both-set is an attempted dual-scope write we can't
  // sensibly dispatch.
  const hasCluster = Boolean(entry.storyClusterId)
  const hasEntity = Boolean(entry.entityId)
  if (hasCluster === hasEntity) {
    await prisma.rawSignalQueue.update({
      where: { id: queueId },
      data: {
        status: 'failed',
        errorMessage: hasCluster
          ? 'Both storyClusterId and entityId set — runner scope ambiguous'
          : 'Neither storyClusterId nor entityId set — runner scope missing',
      },
    })
    return
  }

  // Mark running
  await prisma.rawSignalQueue.update({
    where: { id: queueId },
    data: { status: 'running' },
  })

  let ctx: RunnerContext

  const base: BaseRunnerContext = {
    queueId: entry.id,
    umbrellaArcId: entry.umbrellaArcId,
    signalType: entry.signalType as SignalType,
    triggerLayer: entry.triggerLayer,
    triggerReason: entry.triggerReason,
    approvedByAdmin: entry.approvedByAdmin,
  }

  if (hasCluster && entry.storyClusterId) {
    // Legacy cluster-scoped path — load cluster + latest story.
    const cluster = await prisma.storyCluster.findUnique({
      where: { id: entry.storyClusterId },
    })
    if (!cluster) {
      await prisma.rawSignalQueue.update({
        where: { id: queueId },
        data: {
          status: 'failed',
          errorMessage: 'StoryCluster not found',
        },
      })
      return
    }
    const latestStory = await prisma.story.findFirst({
      where: { storyClusterId: entry.storyClusterId },
      orderBy: { createdAt: 'desc' },
    })
    if (!latestStory) {
      await prisma.rawSignalQueue.update({
        where: { id: queueId },
        data: {
          status: 'failed',
          errorMessage: 'No analyses for cluster',
        },
      })
      return
    }
    let entities: string[] = []
    try {
      const parsed = JSON.parse(cluster.clusterKeywords)
      if (Array.isArray(parsed)) entities = parsed.map((e) => String(e))
    } catch {
      entities = []
    }
    ctx = {
      ...base,
      scope: 'cluster',
      storyClusterId: entry.storyClusterId,
      entityId: null,
      cluster: {
        id: cluster.id,
        headline: latestStory.headline,
        synopsis: latestStory.synopsis,
        firstDetectedAt: cluster.firstDetectedAt,
        entities,
        signalCategory: cluster.signalCategory ?? latestStory.signalCategory,
      },
      entity: null,
    }
  } else if (hasEntity && entry.entityId) {
    // Phase 1c.2a entity-scoped path — load TrackedEntity + aliases.
    const trackedEntity = await prisma.trackedEntity.findUnique({
      where: { id: entry.entityId },
      select: {
        id: true,
        identifier: true,
        name: true,
        category: true,
        entityStrings: true,
      },
    })
    if (!trackedEntity) {
      await prisma.rawSignalQueue.update({
        where: { id: queueId },
        data: {
          status: 'failed',
          errorMessage: 'TrackedEntity not found',
        },
      })
      return
    }
    const strings = trackedEntity.entityStrings as { aliases?: unknown } | null
    const aliases = Array.isArray(strings?.aliases)
      ? strings!.aliases.map((a) => String(a))
      : [trackedEntity.identifier, trackedEntity.name]
    ctx = {
      ...base,
      scope: 'entity',
      storyClusterId: null,
      entityId: entry.entityId,
      cluster: null,
      entity: {
        id: trackedEntity.id,
        identifier: trackedEntity.identifier,
        name: trackedEntity.name,
        category: trackedEntity.category,
        aliases,
      },
    }
  } else {
    // Unreachable — invariant guard above prevents this branch. Defensive
    // fallthrough to satisfy TS exhaustiveness.
    await prisma.rawSignalQueue.update({
      where: { id: queueId },
      data: {
        status: 'failed',
        errorMessage: 'Unreachable runner scope branch',
      },
    })
    return
  }

  try {
    const result = await runner(ctx)

    if (!result) {
      await prisma.rawSignalQueue.update({
        where: { id: queueId },
        data: {
          status: 'skipped',
          errorMessage: 'Integration returned null (no relevant data)',
        },
      })
      return
    }

    // Write RawSignalLayer row. Exactly one of storyClusterId/entityId is
    // set by the invariant check above — pass both through; the null side
    // is stored as NULL.
    const signalLayer = await prisma.rawSignalLayer.create({
      data: {
        storyClusterId: entry.storyClusterId,
        entityId: entry.entityId,
        umbrellaArcId: entry.umbrellaArcId,
        signalType: entry.signalType,
        signalSource: result.signalSource,
        captureDate: result.captureDate,
        coordinates: result.coordinates ?? undefined,
        rawContent: result.rawContent as object,
        haikuSummary: result.haikuSummary,
        divergenceFlag: result.divergenceFlag,
        divergenceDescription: result.divergenceDescription,
        confidenceLevel: result.confidenceLevel,
      },
    })

    // Mark queue completed
    await prisma.rawSignalQueue.update({
      where: { id: queueId },
      data: {
        status: 'completed',
        resultSignalLayerId: signalLayer.id,
      },
    })

    // ── PHASE 2 (Session 4): POST-WRITE HOOKS ─────────────────────────
    // Fire-and-forget. Writes ground_truth-stream GraphNode/GraphEdge,
    // ArcTimelineEvent(raw_signal), and EntitySignalIndex rows for every
    // entity currently linked to this cluster. Never blocks the runner.
    ;(async () => {
      try {
        const { onRawSignalWritten } = await import('@/lib/raw-signal-hooks')
        await onRawSignalWritten(signalLayer.id)
      } catch (err) {
        console.warn(
          '[raw-signals/runner] Post-write hooks failed (non-blocking):',
          err instanceof Error ? err.message : err,
        )
      }
    })()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[raw-signals/runner] Integration ${entry.signalType} failed for queue ${queueId}:`,
      msg,
    )
    await prisma.rawSignalQueue.update({
      where: { id: queueId },
      data: {
        status: 'failed',
        errorMessage: msg.substring(0, 500),
      },
    })
  }
}

/**
 * Process all pending queue entries for a given cluster. Runs entries in
 * parallel (reasonable for 5-10 integrations) but catches all errors so one
 * bad integration doesn't kill the batch.
 *
 * This is the entry point called from the pipeline worker after
 * queueRawSignalEnrichment populates the queue.
 */
export async function processClusterQueue(storyClusterId: string): Promise<{
  processed: number
  failed: number
  skipped: number
}> {
  // Only pick up records the runner is allowed to process right now:
  //   - status='pending' (always)
  //   - status='requires_approval' AND approvedByAdmin=true
  // PACER (legal_pacer) always routes through requires_approval, never pending.
  const pending = await prisma.rawSignalQueue.findMany({
    where: {
      storyClusterId,
      OR: [
        { status: 'pending' },
        { status: 'requires_approval', approvedByAdmin: true },
      ],
    },
    select: { id: true, signalType: true },
  })

  let processed = 0
  let failed = 0
  let skipped = 0

  await Promise.all(
    pending.map(async (entry) => {
      try {
        await processQueueEntry(entry.id)
        const after = await prisma.rawSignalQueue.findUnique({
          where: { id: entry.id },
          select: { status: true },
        })
        if (after?.status === 'completed') processed++
        else if (after?.status === 'failed') failed++
        else if (after?.status === 'skipped') skipped++
      } catch (err) {
        failed++
        console.error(
          `[raw-signals/runner] Uncaught error processing queue ${entry.id}:`,
          err,
        )
      }
    }),
  )

  console.log(
    `[raw-signals/runner] Cluster ${storyClusterId.substring(0, 8)}: processed ${processed}, failed ${failed}, skipped ${skipped} of ${pending.length} queue entries`,
  )
  return { processed, failed, skipped }
}
