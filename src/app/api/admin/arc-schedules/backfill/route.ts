import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { nextScheduledDateFromPhase, type StoryPhase } from '@/lib/arc-phase'

/**
 * POST /api/admin/arc-schedules/backfill
 *
 * One-off retroactive fix: creates ArcPhaseSchedule records for arcs that
 * already exist but were created BEFORE the Step 3 pipeline hooks landed.
 *
 * For each core new_arc Story that has zero ArcPhaseSchedule rows:
 *   1. Look at the entire arc chain (new_arc + all its arc_reruns sharing
 *      the same storyClusterId).
 *   2. Identify the most recently analyzed phase = most recent Story's
 *      arcPhaseAtCreation (fall back to 'first_wave' if null).
 *   3. Insert one 'completed' historical record for that phase with
 *      completedByStoryId = the most-recent Story.
 *   4. Compute the next phase's scheduledFor using firstDetectedAt +
 *      phase-boundary offset. Insert pending record for next phase.
 *
 * Idempotent: skips any arc that already has any ArcPhaseSchedule row.
 *
 * Body: none required. Optional { dryRun: true } to preview without writes.
 */

const PHASE_NEXT: Record<StoryPhase, StoryPhase | null> = {
  first_wave: 'development',
  development: 'consolidation',
  consolidation: 'tail',
  tail: null,
}

function isStoryPhase(v: string | null | undefined): v is StoryPhase {
  return v === 'first_wave' || v === 'development' || v === 'consolidation' || v === 'tail'
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let dryRun = false
  try {
    const body = await request.json()
    if (body && body.dryRun === true) dryRun = true
  } catch {
    // no body is fine
  }

  // Find all core new_arc stories
  const newArcs = await prisma.story.findMany({
    where: {
      analysisType: 'new_arc',
      arcImportance: 'core',
      umbrellaArcId: { not: null },
    },
    select: {
      id: true,
      umbrellaArcId: true,
      arcLabel: true,
      arcPhaseAtCreation: true,
      storyClusterId: true,
      createdAt: true,
    },
  })

  const report: Array<{
    arcLabel: string | null
    storyArcId: string
    action: 'backfilled' | 'skipped-already-has-schedules' | 'skipped-tail-reached'
    historicalRecordPhase?: string
    nextPendingPhase?: string
    nextScheduledFor?: string
  }> = []

  for (const arc of newArcs) {
    // Skip if any schedule already exists for this arc
    const existing = await prisma.arcPhaseSchedule.findFirst({
      where: { storyArcId: arc.id },
      select: { id: true },
    })
    if (existing) {
      report.push({
        arcLabel: arc.arcLabel,
        storyArcId: arc.id,
        action: 'skipped-already-has-schedules',
      })
      continue
    }

    // Find most recent Story in this arc's chain (either the new_arc itself or any arc_rerun)
    const mostRecent = await prisma.story.findFirst({
      where: {
        OR: [
          { id: arc.id },
          {
            analysisType: 'arc_rerun',
            storyClusterId: arc.storyClusterId,
            umbrellaArcId: arc.umbrellaArcId,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, arcPhaseAtCreation: true, createdAt: true },
    })

    const completedPhase: StoryPhase = isStoryPhase(mostRecent?.arcPhaseAtCreation)
      ? (mostRecent!.arcPhaseAtCreation as StoryPhase)
      : 'first_wave'

    const nextPhase = PHASE_NEXT[completedPhase]

    // Fetch cluster firstDetectedAt for next-phase scheduling
    let firstDetectedAt: Date | null = null
    if (arc.storyClusterId) {
      const cluster = await prisma.storyCluster.findUnique({
        where: { id: arc.storyClusterId },
        select: { firstDetectedAt: true },
      })
      firstDetectedAt = cluster?.firstDetectedAt ?? null
    }
    const anchor = firstDetectedAt ?? arc.createdAt

    // Insert historical "completed" record for the most-recently-analyzed phase
    // and (if not tail) a pending record for the next phase
    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        // Historical completed record — scheduledFor = most recent Story's createdAt
        await tx.arcPhaseSchedule.create({
          data: {
            storyArcId: arc.id,
            umbrellaArcId: arc.umbrellaArcId!,
            targetPhase: completedPhase,
            scheduledFor: mostRecent?.createdAt ?? arc.createdAt,
            status: 'completed',
            completedAt: mostRecent?.createdAt ?? arc.createdAt,
            completedByStoryId: mostRecent?.id ?? arc.id,
            isSkipped: false,
          },
        })

        // Pending record for next phase (if applicable)
        if (nextPhase) {
          const scheduledFor = nextScheduledDateFromPhase(completedPhase, anchor)
          if (scheduledFor) {
            await tx.arcPhaseSchedule.create({
              data: {
                storyArcId: arc.id,
                umbrellaArcId: arc.umbrellaArcId!,
                targetPhase: nextPhase,
                scheduledFor,
                status: 'pending',
                isSkipped: false,
              },
            })
          }
        }
      })
    }

    if (nextPhase) {
      const previewDate = nextScheduledDateFromPhase(completedPhase, anchor)
      report.push({
        arcLabel: arc.arcLabel,
        storyArcId: arc.id,
        action: 'backfilled',
        historicalRecordPhase: completedPhase,
        nextPendingPhase: nextPhase,
        nextScheduledFor: previewDate?.toISOString(),
      })
    } else {
      report.push({
        arcLabel: arc.arcLabel,
        storyArcId: arc.id,
        action: 'skipped-tail-reached',
        historicalRecordPhase: completedPhase,
      })
    }
  }

  return Response.json({
    dryRun,
    totalNewArcs: newArcs.length,
    processed: report.length,
    backfilled: report.filter((r) => r.action === 'backfilled').length,
    alreadyHadSchedules: report.filter((r) => r.action === 'skipped-already-has-schedules').length,
    tailReached: report.filter((r) => r.action === 'skipped-tail-reached').length,
    report,
  })
}
