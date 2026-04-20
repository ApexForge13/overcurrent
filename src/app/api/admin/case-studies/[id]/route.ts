import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'

/**
 * GET /api/admin/case-studies/[id]
 *
 * Detail view of a single case-study entry. Includes the full markdown body
 * plus parent cluster/umbrella names for breadcrumb display.
 *
 * Admin-only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const entry = await prisma.caseStudyEntry.findUnique({
    where: { id },
    include: {
      storyCluster: { select: { id: true, clusterHeadline: true, currentPhase: true } },
      umbrellaArc: { select: { id: true, name: true } },
      rawSignalLayer: { select: { id: true, signalType: true, signalSource: true, captureDate: true } },
    },
  })

  if (!entry) return Response.json({ error: 'Case study not found' }, { status: 404 })

  return Response.json({ entry })
}

/**
 * PATCH /api/admin/case-studies/[id]
 *
 * Toggle the isPublishable flag (or update other admin-curated fields).
 * Body: { isPublishable: boolean }
 *
 * Admin-only.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { isPublishable } = body as { isPublishable?: boolean }
  if (isPublishable === undefined) {
    return Response.json({ error: 'Must provide isPublishable' }, { status: 400 })
  }
  if (typeof isPublishable !== 'boolean') {
    return Response.json({ error: 'isPublishable must be boolean' }, { status: 400 })
  }

  try {
    const updated = await prisma.caseStudyEntry.update({
      where: { id },
      data: { isPublishable },
      select: { id: true, isPublishable: true, headline: true, updatedAt: true },
    })
    console.log(`[case-study] ${updated.headline.substring(0, 60)}: isPublishable=${updated.isPublishable}`)
    return Response.json({ entry: updated })
  } catch (err) {
    console.error('[case-study PATCH] update failed:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'Case study not found or update failed' }, { status: 404 })
  }
}
