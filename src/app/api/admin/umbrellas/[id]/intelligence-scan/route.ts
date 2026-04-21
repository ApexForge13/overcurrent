import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { runIntelligenceScan, getLatestRecommendations } from '@/lib/intelligence-scan'
import { featureFlags } from '@/lib/feature-flags'

/**
 * POST /api/admin/umbrellas/[id]/intelligence-scan
 *
 * Runs a fresh Umbrella Intelligence Scan (Haiku). Persists to
 * UmbrellaIntelligenceScan table and updates UmbrellaArc.intelligenceScanLastRunAt.
 * Returns the new scan's recommendations.
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
    const result = await runIntelligenceScan(id)
    return Response.json({
      scanId: result.scanId,
      ranAt: result.ranAt.toISOString(),
      recommendations: result.recommendations,
      limitedData: result.limitedData,
      costUsd: result.costUsd,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown scan error'
    return Response.json({ error: msg }, { status: 500 })
  }
}

/**
 * GET /api/admin/umbrellas/[id]/intelligence-scan
 *
 * Returns the latest stored recommendations without running a new scan.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  const latest = await getLatestRecommendations(id)
  return Response.json({
    scanId: latest.scanId,
    ranAt: latest.ranAt?.toISOString() ?? null,
    recommendations: latest.recommendations,
    limitedData: latest.limitedData,
  })
}
