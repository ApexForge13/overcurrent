import { requireAdmin } from '@/lib/auth-guard'
import { runQualityReview } from '@/lib/quality-review'

/**
 * POST /api/admin/quality-review/[storyId]/run
 *
 * Manually trigger the quality review agent for a single story. Used from
 * the admin review queue when a story was created before Phase 3 or when
 * a prior review call failed.
 *
 * Idempotent via runQualityReview: if a QualityReviewCard already exists
 * for the story, the function no-ops and returns null.
 *
 * Kill verdicts auto-archive the story. Non-kill verdicts leave status
 * unchanged (admin still owns the approve/hold decision).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ storyId: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { storyId } = await params
  if (!storyId) return Response.json({ error: 'storyId required' }, { status: 400 })

  try {
    const result = await runQualityReview(storyId)
    if (!result) {
      return Response.json(
        { ok: false, message: 'Story not found, not in review status, or already reviewed' },
        { status: 200 },
      )
    }
    return Response.json({ ok: true, result })
  } catch (err) {
    console.error('[api/quality-review] failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Quality review failed' },
      { status: 500 },
    )
  }
}
