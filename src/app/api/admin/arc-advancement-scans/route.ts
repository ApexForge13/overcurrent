import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { getUnresolvedAdvancements } from '@/lib/arc-advancement-scan'
import { featureFlags } from '@/lib/feature-flags'

/**
 * GET /api/admin/arc-advancement-scans
 *
 * Returns medium+ confidence advancement detections that haven't yet been
 * triggered into a full re-analysis. Used by the arc-queue page to render
 * "Story advancement detected" banners.
 *
 * Low-confidence scans are excluded per MIN_SIGNAL rule — they are stored
 * in the table for tuning but never surfaced to the UI.
 */
export async function GET(_request: NextRequest) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const items = await getUnresolvedAdvancements()
  return Response.json({
    items: items.map(i => ({
      ...i,
      scannedAt: i.scannedAt.toISOString(),
    })),
    count: items.length,
  })
}
