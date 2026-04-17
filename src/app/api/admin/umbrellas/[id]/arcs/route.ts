import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { recommendedPhaseFromFirstDetectedAt } from '@/lib/arc-phase'

/**
 * GET /api/admin/umbrellas/[id]/arcs
 *
 * Returns active core story arcs (Stories with analysisType='new_arc',
 * arcImportance='core', not archived) under this umbrella. Used by the
 * arc_rerun dropdown on the analysis initiation form.
 *
 * Each arc entry includes the recommended next phase based on time elapsed
 * since the parent StoryCluster.firstDetectedAt. Falls back to Story.createdAt
 * if the arc has no cluster assigned (signal tracking failed).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  const umbrella = await prisma.umbrellaArc.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!umbrella) return Response.json({ error: 'Umbrella not found' }, { status: 404 })

  const arcs = await prisma.story.findMany({
    where: {
      umbrellaArcId: id,
      analysisType: 'new_arc',
      arcImportance: 'core',
      status: { not: 'archived' },
    },
    select: {
      id: true,
      arcLabel: true,
      headline: true,
      searchQuery: true,
      createdAt: true,
      storyClusterId: true,
      storyPhase: true,
      storyCluster: {
        select: {
          id: true,
          currentPhase: true,
          firstDetectedAt: true,
          totalAnalysesRun: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  })

  const now = new Date()
  const enriched = arcs.map((a) => {
    const firstDetected = a.storyCluster?.firstDetectedAt ?? a.createdAt
    const hoursElapsed = Math.max(0, (now.getTime() - new Date(firstDetected).getTime()) / (60 * 60 * 1000))
    const recommendedPhase = recommendedPhaseFromFirstDetectedAt(firstDetected, now)
    return {
      id: a.id,
      arcLabel: a.arcLabel ?? a.headline,
      headline: a.headline,
      // Original search query from the initiating arc — used by the analyze form
      // to auto-populate the query input when the arc is selected for re-run.
      searchQuery: a.searchQuery,
      createdAt: a.createdAt,
      currentPhase: a.storyCluster?.currentPhase ?? a.storyPhase ?? 'first_wave',
      totalAnalysesRun: a.storyCluster?.totalAnalysesRun ?? 1,
      firstDetectedAt: firstDetected,
      hoursElapsed: Math.round(hoursElapsed * 10) / 10,
      recommendedPhase,
    }
  })

  return Response.json({ arcs: enriched })
}
