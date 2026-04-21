import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { runArcAdvancementScan } from '@/lib/arc-advancement-scan'
import { featureFlags } from '@/lib/feature-flags'

/**
 * POST /api/admin/stories/[id]/advancement-scan
 *
 * Manually run an arc advancement scan for a single core story arc. Used for:
 *   - Admin-initiated scans from the umbrella detail page
 *   - Manual testing / debugging
 *
 * Scheduled scans (driven by umbrella.scanFrequency) will live in a separate
 * cron/worker — out of scope for this route.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  try {
    const result = await runArcAdvancementScan(id)
    return Response.json({
      scanId: result.scanId,
      advancementDetected: result.advancementDetected,
      confidenceLevel: result.confidenceLevel,
      rationale: result.rationale,
      shouldNotifyUI: result.shouldNotifyUI,
      scannedAt: result.scannedAt.toISOString(),
      costUsd: result.costUsd,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown scan error'
    return Response.json({ error: msg }, { status: 400 })
  }
}
