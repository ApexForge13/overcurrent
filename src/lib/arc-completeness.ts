import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/db'

/**
 * Arc completeness (Session 3 Step 6)
 *
 * A StoryCluster's arc quality level, derived from ArcPhaseSchedule records
 * attached to the cluster's initiating new_arc Story.
 *
 * Levels:
 *   complete         — all 4 phases have at least one completed schedule
 *   partial          — 2 or 3 phases covered, contiguous from first_wave
 *   first_wave_only  — only first_wave completed
 *   incomplete       — non-sequential coverage (e.g. first_wave + consolidation with development missing)
 *   null             — cluster has no new_arc Story (one-off / standalone container)
 *
 * Used by:
 *   - Signal tracker (src/lib/signal/index.ts) — recomputes after each new analysis
 *   - Umbrella detail API (src/app/api/admin/umbrellas/[id]/contents)
 *   - Confidence gating in outlet-fingerprint / category-pattern / predictive-signal
 *     (complete + partial arcs only when confidence > 60%)
 *   - PredictiveSignal data-quality banner
 */

export type ArcCompleteness = 'complete' | 'partial' | 'first_wave_only' | 'incomplete'

type TxClient = Pick<PrismaClient, 'story' | 'arcPhaseSchedule' | 'storyCluster'>

/**
 * Compute arc completeness from a set of completed phase names.
 * Pure function — exported for the umbrella contents API to reuse.
 */
export function classifyCompleteness(completedPhases: Set<string>): ArcCompleteness {
  const phases = ['first_wave', 'development', 'consolidation', 'tail'] as const
  const completedInOrder = phases.map((p) => completedPhases.has(p))
  const count = completedInOrder.filter(Boolean).length

  if (count === 4) return 'complete'
  if (count === 1 && completedInOrder[0]) return 'first_wave_only'

  // Contiguous from first_wave = partial; gaps = incomplete
  let seenCompleted = false
  let contiguous = true
  for (let i = 0; i < completedInOrder.length; i++) {
    if (completedInOrder[i]) {
      seenCompleted = true
    } else if (seenCompleted) {
      const restTrue = completedInOrder.slice(i).some((x) => x)
      if (restTrue) {
        contiguous = false
        break
      }
    }
  }

  if (count >= 2 && contiguous) return 'partial'
  return 'incomplete'
}

/**
 * Compute the completeness for a given StoryCluster without writing it back.
 * Returns null if the cluster has no new_arc Story.
 */
export async function computeClusterArcCompleteness(
  clusterId: string,
  tx: TxClient = defaultPrisma,
): Promise<ArcCompleteness | null> {
  const rootArc = await tx.story.findFirst({
    where: {
      storyClusterId: clusterId,
      analysisType: 'new_arc',
      arcImportance: 'core',
    },
    select: {
      id: true,
      arcPhaseSchedules: {
        where: { status: 'completed' },
        select: { targetPhase: true },
      },
    },
  })

  if (!rootArc) return null

  const completed = new Set(rootArc.arcPhaseSchedules.map((s) => s.targetPhase))
  return classifyCompleteness(completed)
}

/**
 * Compute and persist arcCompleteness on the StoryCluster row.
 * Returns the computed value (or null if the cluster has no new_arc).
 */
export async function recomputeClusterCompleteness(
  clusterId: string,
  tx: TxClient = defaultPrisma,
): Promise<ArcCompleteness | null> {
  const level = await computeClusterArcCompleteness(clusterId, tx)
  await tx.storyCluster.update({
    where: { id: clusterId },
    data: {
      arcCompleteness: level ?? null,
      arcCompletenessComputedAt: new Date(),
    },
  })
  return level
}

/**
 * Given a list of cluster ids, return those whose arcCompleteness indicates
 * high-quality data (complete or partial). Used by confidence gating.
 *
 * Gating rule (Session 3 Step 6 spec):
 *   When fingerprint/pattern aggregation intends to produce confidence > 60%,
 *   pass ONLY complete + partial arcs. Below that threshold, pass all.
 *
 * Caller decides when to apply the gate based on their own confidence target.
 */
export async function filterClustersByArcQuality(
  clusterIds: string[],
  tx: TxClient = defaultPrisma,
  opts: { allowFirstWaveOnly?: boolean } = {},
): Promise<{ included: string[]; excluded: string[]; byLevel: Record<string, number> }> {
  if (clusterIds.length === 0) {
    return { included: [], excluded: [], byLevel: { complete: 0, partial: 0, first_wave_only: 0, incomplete: 0, null: 0 } }
  }

  const rows = await tx.storyCluster.findMany({
    where: { id: { in: clusterIds } },
    select: { id: true, arcCompleteness: true },
  })

  const allowedLevels: Set<string> = new Set(['complete', 'partial'])
  if (opts.allowFirstWaveOnly) allowedLevels.add('first_wave_only')

  const included: string[] = []
  const excluded: string[] = []
  const byLevel: Record<string, number> = { complete: 0, partial: 0, first_wave_only: 0, incomplete: 0, null: 0 }

  for (const row of rows) {
    const key = row.arcCompleteness ?? 'null'
    byLevel[key] = (byLevel[key] ?? 0) + 1
    if (row.arcCompleteness && allowedLevels.has(row.arcCompleteness)) {
      included.push(row.id)
    } else {
      excluded.push(row.id)
    }
  }

  return { included, excluded, byLevel }
}
