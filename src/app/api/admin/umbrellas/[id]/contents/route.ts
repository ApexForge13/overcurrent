import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { prisma } from '@/lib/db'

/**
 * GET /api/admin/umbrellas/[id]/contents
 *
 * Returns nested content for the umbrella detail page:
 *   - arcs: all new_arc Stories with their completeness indicator, next
 *           scheduled re-analysis date, current phase
 *   - oneOffs: all umbrella_tagged Stories with label + date + slug for link
 *
 * Arc completeness is computed from ArcPhaseSchedule records:
 *   - complete:         all 4 phases have at least one completed schedule
 *   - partial:          2-3 phases covered, no gaps (contiguous)
 *   - first_wave_only:  only first_wave completed
 *   - incomplete:       non-sequential coverage (e.g. first_wave + consolidation, no development)
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  const [arcs, oneOffs] = await Promise.all([
    prisma.story.findMany({
      where: {
        umbrellaArcId: id,
        analysisType: 'new_arc',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        headline: true,
        arcLabel: true,
        arcImportance: true,
        arcPhaseAtCreation: true,
        createdAt: true,
        storyClusterId: true,
        searchQuery: true,
        storyCluster: { select: { firstDetectedAt: true, currentPhase: true } },
        arcPhaseSchedules: {
          select: {
            id: true,
            targetPhase: true,
            status: true,
            scheduledFor: true,
            completedAt: true,
            isSkipped: true,
          },
        },
      },
    }),
    prisma.story.findMany({
      where: {
        umbrellaArcId: id,
        analysisType: 'umbrella_tagged',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        headline: true,
        arcLabel: true,
        createdAt: true,
        arcPhaseAtCreation: true,
        primaryCategory: true,
      },
    }),
  ])

  const arcsEnriched = arcs.map(a => {
    // Phases that have any completed schedule
    const completedPhases = new Set<string>()
    for (const sched of a.arcPhaseSchedules) {
      if (sched.status === 'completed') completedPhases.add(sched.targetPhase)
    }
    // Arc completeness indicator
    const completeness = arcCompleteness(completedPhases)

    // Next scheduled re-analysis (pending, non-skipped, soonest)
    const nextScheduled = a.arcPhaseSchedules
      .filter(s => s.status === 'pending' && !s.isSkipped)
      .sort((x, y) => x.scheduledFor.getTime() - y.scheduledFor.getTime())[0]

    return {
      id: a.id,
      slug: a.slug,
      arcLabel: a.arcLabel ?? a.headline,
      headline: a.headline,
      arcImportance: a.arcImportance,
      currentPhase: a.storyCluster?.currentPhase ?? a.arcPhaseAtCreation ?? 'first_wave',
      completeness,
      completedPhases: Array.from(completedPhases),
      nextScheduled: nextScheduled
        ? {
            targetPhase: nextScheduled.targetPhase,
            scheduledFor: nextScheduled.scheduledFor.toISOString(),
          }
        : null,
      searchQuery: a.searchQuery,
      storyClusterId: a.storyClusterId,
      createdAt: a.createdAt.toISOString(),
    }
  })

  return Response.json({
    arcs: arcsEnriched,
    oneOffs: oneOffs.map(o => ({
      id: o.id,
      slug: o.slug,
      label: o.arcLabel ?? o.headline,
      headline: o.headline,
      primaryCategory: o.primaryCategory,
      arcPhaseAtCreation: o.arcPhaseAtCreation,
      createdAt: o.createdAt.toISOString(),
    })),
  })
}

function arcCompleteness(completed: Set<string>): 'complete' | 'partial' | 'first_wave_only' | 'incomplete' {
  const phases = ['first_wave', 'development', 'consolidation', 'tail']
  const completedInOrder = phases.map(p => completed.has(p))
  const count = completedInOrder.filter(Boolean).length

  if (count === 4) return 'complete'
  if (count === 1 && completedInOrder[0]) return 'first_wave_only'

  // Check if completed phases are contiguous from first_wave (partial) or have gaps (incomplete)
  let inSequence = true
  let seenCompleted = false
  for (let i = 0; i < completedInOrder.length; i++) {
    if (completedInOrder[i]) seenCompleted = true
    else if (seenCompleted) {
      // A gap after a completed phase = not contiguous
      // Unless all following are false (trailing tail-etc absent is OK)
      const restTrue = completedInOrder.slice(i).some(x => x)
      if (restTrue) { inSequence = false; break }
    }
  }

  if (count >= 2 && inSequence) return 'partial'
  return 'incomplete'
}
