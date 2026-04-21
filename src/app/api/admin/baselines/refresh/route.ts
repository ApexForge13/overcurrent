import { requireAdmin } from '@/lib/auth-guard'
import { prisma } from '@/lib/db'
import { refreshAllBaselines } from '@/lib/baselines/refresh-all'

/**
 * POST /api/admin/baselines/refresh
 *
 * Manual trigger for the baseline refresher. Useful for:
 *   - Admin-initiated rescans from the dashboard
 *   - Post-migration smoke test (verify refresher runs against empty
 *     tables without error)
 *   - Local debugging
 *
 * Phase 1b has no observation data yet; successful response will report
 * entityRowsWritten = N trackedEntities × 4 metrics,
 * zoneRowsWritten   = 40 zones × 4 metrics = 160,
 * all with matureCount=0 because sampleCount=0 per row.
 */
export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const result = await refreshAllBaselines(prisma)
  return Response.json(result)
}
