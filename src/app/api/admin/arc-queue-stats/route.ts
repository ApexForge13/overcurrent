import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

/**
 * GET /api/admin/arc-queue-stats
 *
 * Returns this-month analysis counts broken down by analysis type, for the
 * ratio stats bar at the top of the arc-queue page.
 *
 * Target ratio (visibility only, does not block any action):
 *   40% combined (story arc + umbrella-tagged)
 *   60% standalone
 *
 * - storyArcAnalyses = Story.analysisType IN ('new_arc', 'arc_rerun')
 * - umbrellaTagged   = Story.analysisType = 'umbrella_tagged'
 * - standalone       = Story.analysisType = 'standalone' OR NULL
 * - All counts are over Stories created this calendar month.
 */
export async function GET(_request: NextRequest) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [arcCount, taggedCount, standaloneCount, nullCount, total] = await Promise.all([
    prisma.story.count({
      where: {
        createdAt: { gte: monthStart, lt: nextMonth },
        analysisType: { in: ['new_arc', 'arc_rerun'] },
      },
    }),
    prisma.story.count({
      where: {
        createdAt: { gte: monthStart, lt: nextMonth },
        analysisType: 'umbrella_tagged',
      },
    }),
    prisma.story.count({
      where: {
        createdAt: { gte: monthStart, lt: nextMonth },
        analysisType: 'standalone',
      },
    }),
    prisma.story.count({
      where: {
        createdAt: { gte: monthStart, lt: nextMonth },
        analysisType: null,
      },
    }),
    prisma.story.count({
      where: { createdAt: { gte: monthStart, lt: nextMonth } },
    }),
  ])

  // Treat null analysisType as standalone (legacy stories + opt-out)
  const effectiveStandalone = standaloneCount + nullCount

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const arcPct = pct(arcCount)
  const taggedPct = pct(taggedCount)
  const standalonePct = pct(effectiveStandalone)

  const combinedArcTagged = arcPct + taggedPct // target 40%
  let ratioStatus: 'above' | 'on' | 'below'
  if (combinedArcTagged >= 38) ratioStatus = 'above' // within tolerance
  else if (combinedArcTagged >= 30) ratioStatus = 'on'
  else ratioStatus = 'below'

  return Response.json({
    month: {
      start: monthStart.toISOString(),
      label: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    },
    total,
    storyArc: { count: arcCount, pct: arcPct },
    umbrellaTagged: { count: taggedCount, pct: taggedPct },
    standalone: { count: effectiveStandalone, pct: standalonePct },
    target: {
      arcAndTaggedPct: 40,
      standalonePct: 60,
      actual: combinedArcTagged,
      status: ratioStatus,
    },
  })
}
