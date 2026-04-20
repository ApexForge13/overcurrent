import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { createCaseStudyFromRawSignalReview } from '@/lib/case-study-hooks'

/**
 * PATCH /api/admin/raw-signals/[id]
 *
 * Update a RawSignalLayer row's admin-review fields. Specifically:
 *   - reviewedByAdmin (boolean)
 *   - adminNotes     (string \u2014 sets editorial intent)
 *
 * When the patch results in `reviewedByAdmin=true` AND `adminNotes` non-empty,
 * fires the case-study auto-create hook so the finding gets archived to the
 * CaseStudyEntry library. The hook is non-blocking \u2014 case-study creation
 * failures don't roll back the row update.
 *
 * No public surface; admin-only.
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

  const { reviewedByAdmin, adminNotes } = body as {
    reviewedByAdmin?: boolean
    adminNotes?: string | null
  }

  const data: { reviewedByAdmin?: boolean; adminNotes?: string | null } = {}
  if (reviewedByAdmin !== undefined) {
    if (typeof reviewedByAdmin !== 'boolean') {
      return Response.json({ error: 'reviewedByAdmin must be boolean' }, { status: 400 })
    }
    data.reviewedByAdmin = reviewedByAdmin
  }
  if (adminNotes !== undefined) {
    if (adminNotes !== null && typeof adminNotes !== 'string') {
      return Response.json({ error: 'adminNotes must be a string or null' }, { status: 400 })
    }
    data.adminNotes = adminNotes
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'Must provide reviewedByAdmin or adminNotes' }, { status: 400 })
  }

  let updated: Awaited<ReturnType<typeof prisma.rawSignalLayer.update>>
  try {
    updated = await prisma.rawSignalLayer.update({ where: { id }, data })
  } catch (err) {
    console.error('[raw-signals PATCH] update failed:', err instanceof Error ? err.message : err)
    return Response.json({ error: 'RawSignalLayer not found or update failed' }, { status: 404 })
  }

  // ── Auto-create case study when admin marks as reviewed with notes ──
  let caseStudyEntryId: string | null = null
  if (updated.reviewedByAdmin && updated.adminNotes && updated.adminNotes.trim().length > 0) {
    try {
      const entry = await createCaseStudyFromRawSignalReview({
        rawSignalLayerId: updated.id,
        storyClusterId: updated.storyClusterId,
        umbrellaArcId: updated.umbrellaArcId,
        signalType: updated.signalType,
        signalSource: updated.signalSource,
        haikuSummary: updated.haikuSummary,
        divergenceFlag: updated.divergenceFlag,
        divergenceDescription: updated.divergenceDescription,
        adminNotes: updated.adminNotes,
        reviewedByAdmin: updated.reviewedByAdmin,
      })
      if (entry) {
        caseStudyEntryId = entry.id
        console.log(`[case-study] Auto-created raw-signal case study ${entry.id.substring(0, 12)} for raw-signal ${updated.id.substring(0, 12)}`)
      }
    } catch (err) {
      console.error(
        '[case-study] Raw-signal auto-create failed (non-blocking):',
        err instanceof Error ? err.message : err,
      )
    }
  }

  return Response.json({
    rawSignal: updated,
    caseStudyEntryId,
  })
}
