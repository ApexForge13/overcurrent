import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'

/**
 * GET /api/admin/case-studies
 *
 * List case-study entries with optional filters. Sorted by createdAt descending.
 *
 * Query params:
 *   - signalType        \u2014 exact match
 *   - isPublishable     \u2014 'true' or 'false'
 *   - clusterId         \u2014 exact match on storyClusterId
 *   - umbrellaId        \u2014 exact match on umbrellaArcId
 *   - divergenceType    \u2014 exact match
 *   - storyPhase        \u2014 exact match on storyPhaseAtDetection
 *
 * Admin-only.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const url = new URL(request.url)
  const where: Record<string, unknown> = {}

  const signalType = url.searchParams.get('signalType')
  if (signalType) where.signalType = signalType

  const isPublishableParam = url.searchParams.get('isPublishable')
  if (isPublishableParam === 'true') where.isPublishable = true
  if (isPublishableParam === 'false') where.isPublishable = false

  const clusterId = url.searchParams.get('clusterId')
  if (clusterId) where.storyClusterId = clusterId

  const umbrellaId = url.searchParams.get('umbrellaId')
  if (umbrellaId) where.umbrellaArcId = umbrellaId

  const divergenceType = url.searchParams.get('divergenceType')
  if (divergenceType) where.divergenceType = divergenceType

  const storyPhase = url.searchParams.get('storyPhase')
  if (storyPhase) where.storyPhaseAtDetection = storyPhase

  const entries = await prisma.caseStudyEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      headline: true,
      signalType: true,
      divergenceType: true,
      storyPhaseAtDetection: true,
      isPublishable: true,
      storyClusterId: true,
      umbrellaArcId: true,
      rawSignalLayerId: true,
      createdAt: true,
      updatedAt: true,
      // body excluded from list view \u2014 kept on detail
    },
  })

  return Response.json({ entries, count: entries.length })
}
