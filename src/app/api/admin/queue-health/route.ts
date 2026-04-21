import { requireAdmin } from '@/lib/auth-guard'
import { checkQueueHealth } from '@/lib/queue/health'

/**
 * GET /api/admin/queue-health
 *
 * Admin-gated queue-infrastructure probe. Returns Redis ping status and
 * per-queue job-count breakdowns. Consumed by the admin dashboard (future)
 * and by operator scripts. No caching — always reflects the current state.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const report = await checkQueueHealth()
  const status = report.redis === 'ok' ? 200 : 503
  return Response.json(report, { status })
}
