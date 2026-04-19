/**
 * Raw signal write hook (Phase 2).
 *
 * Called fire-and-forget from raw-signals/runner.ts immediately after a
 * RawSignalLayer row is created. Runs three side-effects:
 *
 *   1. populateRawSignalGraph   — GraphNode + GraphEdge (ground_truth stream)
 *                                  (contradicts/corroborates edge to cluster)
 *   2. writeRawSignalEvent      — ArcTimelineEvent(raw_signal)
 *   3. writeEntitySignalIndex   — one EntitySignalIndex row per entity
 *                                  currently associated with the cluster
 *
 * Every step catches its own errors. Failure in one step does not skip the others.
 * Under no circumstance does a failure here affect the raw-signals runner flow.
 */

import { prisma } from '@/lib/db'
import { populateRawSignalGraph } from './publish-hooks/graph-population'
import { writeRawSignalEvent } from './publish-hooks/arc-timeline'

/**
 * Fire-and-forget orchestrator. Called after RawSignalLayer create in runner.ts.
 *
 * Accepts the RawSignalLayer id; reloads from the DB to keep the runner
 * call-site simple (no need to thread every field through).
 */
export async function onRawSignalWritten(rawSignalLayerId: string): Promise<void> {
  try {
    const signal = await prisma.rawSignalLayer.findUnique({
      where: { id: rawSignalLayerId },
      select: {
        id: true,
        storyClusterId: true,
        umbrellaArcId: true,
        signalType: true,
        signalSource: true,
        divergenceFlag: true,
        divergenceDescription: true,
        confidenceLevel: true,
        haikuSummary: true,
        captureDate: true,
      },
    })
    if (!signal) {
      console.warn(`[raw-signal-hooks] Signal ${rawSignalLayerId} not found; skipping`)
      return
    }

    const confidenceLevel = signal.confidenceLevel as 'low' | 'medium' | 'high'

    // Step 1: graph population (ground_truth stream node + contradicts/corroborates edge)
    await populateRawSignalGraph({
      rawSignalLayerId: signal.id,
      storyClusterId: signal.storyClusterId,
      signalType: signal.signalType,
      signalSource: signal.signalSource,
      divergenceFlag: signal.divergenceFlag,
      divergenceDescription: signal.divergenceDescription,
      confidenceLevel,
      haikuSummary: signal.haikuSummary,
      captureDate: signal.captureDate,
    }).catch((err) => {
      console.warn('[raw-signal-hooks] graph step failed:', err instanceof Error ? err.message : err)
    })

    // Step 2: ArcTimelineEvent(raw_signal) — ground_truth stream
    await writeRawSignalEvent({
      rawSignalLayerId: signal.id,
      storyClusterId: signal.storyClusterId,
      umbrellaArcId: signal.umbrellaArcId,
      signalType: signal.signalType,
      signalSource: signal.signalSource,
      divergenceFlag: signal.divergenceFlag,
      confidenceLevel,
      haikuSummary: signal.haikuSummary,
      captureDate: signal.captureDate,
    }).catch((err) => {
      console.warn('[raw-signal-hooks] timeline step failed:', err instanceof Error ? err.message : err)
    })

    // Step 3: EntitySignalIndex — one row per entity attached to this cluster.
    //
    // Every canonical Entity linked via EntityMention from any Story in this
    // cluster gets a signal index row. This is the accumulating-dossier
    // behavior: entities build up a complete record of every raw signal
    // observed while they are in the news cycle.
    await populateEntitySignalIndexForCluster({
      storyClusterId: signal.storyClusterId,
      rawSignalLayerId: signal.id,
      signalType: signal.signalType,
      signalDate: signal.captureDate,
      signalSummary: signal.haikuSummary,
      confidenceLevel,
    }).catch((err) => {
      console.warn('[raw-signal-hooks] entity-signal-index step failed:', err instanceof Error ? err.message : err)
    })
  } catch (err) {
    console.warn(
      '[raw-signal-hooks] onRawSignalWritten failed (non-blocking):',
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Write EntitySignalIndex rows for every Entity connected to this cluster.
 *
 * "Connected" = has at least one EntityMention where story.storyClusterId === clusterId.
 * Deduplicates on (entityId, rawSignalLayerId) — the raw signal is only indexed
 * once per entity even if the hook fires twice.
 */
export async function populateEntitySignalIndexForCluster(params: {
  storyClusterId: string
  rawSignalLayerId: string
  signalType: string
  signalDate: Date
  signalSummary: string
  confidenceLevel: 'low' | 'medium' | 'high'
  sourceUrl?: string | null
}): Promise<number> {
  try {
    // Find all entities mentioned in any story under this cluster.
    const mentions = await prisma.entityMention.findMany({
      where: { story: { storyClusterId: params.storyClusterId } },
      select: { entityId: true },
      distinct: ['entityId'],
    })

    if (mentions.length === 0) return 0

    const entityIds = mentions.map((m) => m.entityId)

    // Dedupe: skip entities that already have a row for this (entity, rawSignal)
    const existing = await prisma.entitySignalIndex.findMany({
      where: {
        entityId: { in: entityIds },
        rawSignalLayerId: params.rawSignalLayerId,
      },
      select: { entityId: true },
    })
    const alreadyIndexed = new Set(existing.map((e) => e.entityId))

    const toWrite = entityIds.filter((id) => !alreadyIndexed.has(id))
    if (toWrite.length === 0) return 0

    await prisma.entitySignalIndex.createMany({
      data: toWrite.map((entityId) => ({
        entityId,
        signalType: params.signalType,
        rawSignalLayerId: params.rawSignalLayerId,
        signalDate: params.signalDate,
        signalSummary: params.signalSummary.substring(0, 2000),
        sourceUrl: params.sourceUrl ?? null,
        confidenceLevel: params.confidenceLevel,
      })),
    })

    return toWrite.length
  } catch (err) {
    console.warn(
      '[raw-signal-hooks] populateEntitySignalIndexForCluster failed:',
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
