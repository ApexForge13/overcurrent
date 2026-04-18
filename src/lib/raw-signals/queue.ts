/**
 * queueRawSignalEnrichment — the entry point for Session 4's raw signal layer.
 *
 * Fires async after pipeline Phase 7 (signal tracking) completes. MUST NOT
 * block or delay analysis delivery. All errors are logged and swallowed.
 *
 * Runs three independent trigger layers and deduplicates against each other
 * so the same signalType is never queued twice for the same cluster.
 *
 *   Layer 1 (category_trigger) — StoryCluster.signalCategory lookup
 *   Layer 2 (entity_trigger)   — per-entity checks (tickers, chokepoints, etc.)
 *   Layer 3 (keyword_trigger)  — full-text keyword scan
 *
 * Each queued record stores triggerLayer + triggerReason so every source
 * activation is auditable.
 *
 * After queue population, this function returns. The actual integration
 * workers are separate — they poll RawSignalQueue for pending jobs and
 * process them one at a time. See src/lib/raw-signals/runner.ts.
 */

import { prisma } from '@/lib/db'
import { SIGNAL_CATEGORY_SOURCES } from './types'
import type { SignalType, TriggerLayer } from './types'
import {
  matchCompaniesAndTickers,
  matchMaritimeChokepoints,
  matchVesselNames,
} from './entity-matchers'
import { scanKeywords } from './keyword-triggers'

interface QueueEntry {
  signalType: SignalType
  triggerLayer: TriggerLayer
  triggerReason: string
}

export interface QueueRawSignalEnrichmentResult {
  clusterId: string
  queued: QueueEntry[]
  skipped: { signalType: SignalType; reason: string }[]
}

/**
 * Build the full queue entry list for a cluster by running all three
 * trigger layers and deduplicating. The same signalType can only appear
 * once — the first layer to trigger it wins (category > entity > keyword).
 */
export function buildQueueEntries(
  signalCategory: string | null,
  entities: string[],
  fullAnalysisText: string,
): QueueEntry[] {
  const seen = new Set<SignalType>()
  const entries: QueueEntry[] = []

  // ── LAYER 1: category_trigger ────────────────────────────────────────
  if (signalCategory && SIGNAL_CATEGORY_SOURCES[signalCategory]) {
    for (const signalType of SIGNAL_CATEGORY_SOURCES[signalCategory]) {
      if (seen.has(signalType)) continue
      entries.push({
        signalType,
        triggerLayer: 'category_trigger',
        triggerReason: `signalCategory="${signalCategory}"`,
      })
      seen.add(signalType)
    }
  }

  // ── LAYER 2: entity_trigger (synchronous checks) ────────────────────
  // Async matchers (OFAC SDN lookup, Copernicus activation check) are
  // handled inside their own integrations when the queue runner executes
  // them — they produce their own additional queue records as side effects.
  const layer2Matches = [
    ...matchCompaniesAndTickers(entities),
    ...matchMaritimeChokepoints(entities),
    ...matchVesselNames(entities),
  ]
  for (const m of layer2Matches) {
    if (seen.has(m.signalType)) continue
    entries.push({
      signalType: m.signalType,
      triggerLayer: 'entity_trigger',
      triggerReason: m.reason,
    })
    seen.add(m.signalType)
  }

  // ── LAYER 3: keyword_trigger ─────────────────────────────────────────
  const layer3Matches = scanKeywords(fullAnalysisText)
  for (const m of layer3Matches) {
    if (seen.has(m.signalType)) continue
    entries.push({
      signalType: m.signalType,
      triggerLayer: 'keyword_trigger',
      triggerReason: m.reason,
    })
    seen.add(m.signalType)
  }

  return entries
}

/**
 * Fire-and-forget queue population. Called from pipeline.ts after signal
 * tracking completes. Wraps everything in try/catch — a failure here must
 * never break analysis delivery.
 */
export async function queueRawSignalEnrichment(
  storyClusterId: string,
): Promise<QueueRawSignalEnrichmentResult | null> {
  try {
    // Load cluster record (shallow — no umbrella on StoryCluster directly)
    const cluster = await prisma.storyCluster.findUnique({
      where: { id: storyClusterId },
    })

    if (!cluster) {
      console.warn(`[raw-signals] Cluster ${storyClusterId} not found; skipping enrichment queue`)
      return null
    }

    // Load latest story in the cluster — umbrellaArcId lives on Story, not StoryCluster
    const latestStory = await prisma.story.findFirst({
      where: { storyClusterId },
      orderBy: { createdAt: 'desc' },
      include: {
        claims: { select: { claim: true } },
        framings: { select: { framing: true, contrastWith: true } },
      },
    })
    if (!latestStory) {
      console.warn(`[raw-signals] Cluster ${storyClusterId} has no analyses; skipping`)
      return null
    }

    // Resolve signalCategory: cluster first, fall back to story
    const signalCategory = cluster.signalCategory || latestStory.signalCategory || null

    // Parse cluster entities (clusterKeywords is a JSON-encoded string array)
    let entities: string[] = []
    try {
      const parsed = JSON.parse(cluster.clusterKeywords)
      if (Array.isArray(parsed)) entities = parsed.map((e) => String(e))
    } catch {
      entities = []
    }

    // Build full analysis text for Layer 3 keyword scanning
    const analysisText = [
      latestStory.headline,
      latestStory.synopsis,
      latestStory.confidenceNote ?? '',
      ...latestStory.claims.map((c) => c.claim),
      ...latestStory.framings.map((f) => `${f.framing} ${f.contrastWith ?? ''}`),
    ].join('\n')

    // Build queue entries
    const entries = buildQueueEntries(signalCategory, entities, analysisText)

    if (entries.length === 0) {
      console.log(`[raw-signals] Cluster ${storyClusterId.substring(0, 8)}: no triggers fired`)
      return { clusterId: storyClusterId, queued: [], skipped: [] }
    }

    // Insert queue records. Use createMany for efficiency; duplicates are
    // already prevented by our in-memory dedup but we also guard against
    // re-enqueue for the same cluster by skipping signalTypes that already
    // have pending/running/completed records.
    const existing = await prisma.rawSignalQueue.findMany({
      where: {
        storyClusterId,
        status: { in: ['pending', 'running', 'completed'] },
      },
      select: { signalType: true },
    })
    const alreadyQueued = new Set(existing.map((e) => e.signalType))

    const newEntries = entries.filter((e) => !alreadyQueued.has(e.signalType))
    const skipped = entries
      .filter((e) => alreadyQueued.has(e.signalType))
      .map((e) => ({ signalType: e.signalType, reason: 'already queued for this cluster' }))

    if (newEntries.length > 0) {
      await prisma.rawSignalQueue.createMany({
        data: newEntries.map((e) => ({
          storyClusterId,
          umbrellaArcId: latestStory.umbrellaArcId ?? null,
          signalType: e.signalType,
          triggerLayer: e.triggerLayer,
          triggerReason: e.triggerReason,
          status: 'pending',
        })),
      })
    }

    console.log(
      `[raw-signals] Cluster ${storyClusterId.substring(0, 8)}: queued ${newEntries.length}/${entries.length} signals (${skipped.length} already queued)`,
    )

    return {
      clusterId: storyClusterId,
      queued: newEntries,
      skipped,
    }
  } catch (err) {
    console.error(
      '[raw-signals] queueRawSignalEnrichment failed (non-blocking):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
