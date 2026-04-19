import type { PrismaClient } from '@prisma/client'
import { nextScheduledDateFromPhase, type StoryPhase } from '@/lib/arc-phase'

/**
 * Arc phase schedule lifecycle — called from inside Story-creation transaction
 * in pipeline.ts, after the Story is inserted and UmbrellaArc counters are bumped.
 *
 * Two entry points:
 *   - handleNewArcSchedule(): on analysisType='new_arc' with core importance,
 *     create the initial First Wave pending schedule record.
 *   - handleArcRerunSchedule(): on analysisType='arc_rerun', mark the
 *     current pending schedule completed and create the next pending record
 *     based on what phase was just completed.
 *
 * IMPORTANT: arc completeness scores below 2 completed phases produce
 * unreliable signal. Confidence scores should not display above 40% until
 * at least 3 phases are completed for the parent arc. (Displayed in UI —
 * computed from status='completed' count where storyArcId = <the initiating
 * new_arc Story id>.)
 */

type TxClient = Pick<PrismaClient, 'arcPhaseSchedule' | 'storyCluster'>

const VALID_PHASES = new Set<StoryPhase>(['first_wave', 'development', 'consolidation', 'tail'])

/**
 * Called when a new story arc (core importance) is filed.
 * Creates the initial First Wave pending schedule record pointing at this Story.
 */
export async function handleNewArcSchedule(
  tx: TxClient,
  args: {
    storyArcId: string        // the newly-created new_arc Story's id
    umbrellaArcId: string
    arcImportance: string | null
    now?: Date
  },
): Promise<void> {
  // Only core-importance arcs get an automatic schedule
  if (args.arcImportance !== 'core') return

  await tx.arcPhaseSchedule.create({
    data: {
      storyArcId: args.umbrellaArcId ? args.storyArcId : null,
      umbrellaArcId: args.umbrellaArcId,
      targetPhase: 'first_wave',
      scheduledFor: args.now ?? new Date(),
      status: 'pending',
      isSkipped: false,
    },
  })
}

/**
 * Called when an arc_rerun Story is filed.
 *
 * 1. Find the OLDEST pending ArcPhaseSchedule for this arc
 *    (storyArcId = the initiating new_arc Story's id).
 * 2. Mark it completed, setting completedAt + completedByStoryId.
 * 3. Create the NEXT pending schedule using phase boundary logic:
 *      first_wave → firstDetectedAt + 36h
 *      development → firstDetectedAt + 7d
 *      consolidation → firstDetectedAt + 21d
 *      tail → no new record (manual extend prompt)
 *
 * The "completed phase" is the targetPhase of the schedule being marked
 * completed. If no pending schedule exists (e.g., tail-phase arc that was
 * manually extended), this is a no-op — the rerun is recorded but no
 * automatic next-schedule is generated.
 */
export async function handleArcRerunSchedule(
  tx: TxClient,
  args: {
    rerunStoryId: string      // the newly-created arc_rerun Story's id
    arcRootStoryId: string    // the initiating new_arc Story's id
    umbrellaArcId: string
    storyClusterId: string | null
    now?: Date
  },
): Promise<void> {
  const now = args.now ?? new Date()

  // Find the oldest pending schedule for this arc
  const pending = await tx.arcPhaseSchedule.findFirst({
    where: {
      storyArcId: args.arcRootStoryId,
      status: 'pending',
    },
    orderBy: { scheduledFor: 'asc' },
  })

  if (!pending) {
    // No pending schedule — either the arc never had one, or it reached tail
    // and was manually extended. Record the rerun but don't auto-advance.
    return
  }

  // Mark current schedule completed
  await tx.arcPhaseSchedule.update({
    where: { id: pending.id },
    data: {
      status: 'completed',
      completedAt: now,
      completedByStoryId: args.rerunStoryId,
    },
  })

  // Compute next-phase scheduledFor from firstDetectedAt anchor
  let firstDetectedAt: Date | null = null
  if (args.storyClusterId) {
    const cluster = await tx.storyCluster.findUnique({
      where: { id: args.storyClusterId },
      select: { firstDetectedAt: true },
    })
    firstDetectedAt = cluster?.firstDetectedAt ?? null
  }

  // Determine next-phase scheduledFor
  const completedPhase = pending.targetPhase as StoryPhase
  if (!VALID_PHASES.has(completedPhase)) return

  // Use firstDetectedAt as anchor when available; fall back to now
  // (new arcs without a cluster will still get a sensible schedule)
  const anchor = firstDetectedAt ?? now
  const nextDate = nextScheduledDateFromPhase(completedPhase, anchor)
  if (!nextDate) {
    // tail phase → no auto-next. UI surfaces "Has this story arc concluded?"
    return
  }

  const nextPhase = nextPhaseAfter(completedPhase)
  if (!nextPhase) return

  await tx.arcPhaseSchedule.create({
    data: {
      storyArcId: args.arcRootStoryId,
      umbrellaArcId: args.umbrellaArcId,
      targetPhase: nextPhase,
      scheduledFor: nextDate,
      status: 'pending',
      isSkipped: false,
    },
  })
}

/** Advance the phase ordinal: first_wave → development → consolidation → tail. */
function nextPhaseAfter(phase: StoryPhase): StoryPhase | null {
  switch (phase) {
    case 'first_wave': return 'development'
    case 'development': return 'consolidation'
    case 'consolidation': return 'tail'
    case 'tail': return null
  }
}
