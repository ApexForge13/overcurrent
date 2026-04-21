import { requireAdmin } from '@/lib/auth-guard'
import { runQualityReview } from '@/lib/quality-review'
import { featureFlags } from '@/lib/feature-flags'

/**
 * POST /api/admin/quality-review/[storyId]/run
 *
 * Manually trigger the quality review agent for a single story. Used from
 * the admin review queue when:
 *   - the story was created before Phase 3 (no card exists),
 *   - a prior review call failed,
 *   - an admin deliberately revised the Pattern after a kill and wants to
 *     resubmit (force-re-review).
 *
 * This route always passes force:true — manual admin intent to re-score is
 * never noise. A new QualityReviewCard row is created; any prior cards are
 * preserved as the immutable history of kill/approve decisions.
 *
 * Kill verdicts auto-archive the story. Non-kill verdicts leave status
 * unchanged (admin still owns the approve/hold decision).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ storyId: string }> }) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { storyId } = await params
  if (!storyId) return Response.json({ error: 'storyId required' }, { status: 400 })

  try {
    const result = await runQualityReview(storyId, { force: true })
    if (!result) {
      return Response.json(
        { ok: false, message: 'Story not found or review could not be produced — check server logs' },
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
