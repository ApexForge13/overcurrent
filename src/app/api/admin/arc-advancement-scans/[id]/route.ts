import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { prisma } from '@/lib/db'

/**
 * POST /api/admin/arc-advancement-scans/[id]/trigger
 *
 * [id] = scanId. Marks a specific advancement scan as triggered (the admin
 * clicked "Run full analysis now" on the notification banner). The actual
 * pipeline run happens via the normal analyze form redirect — this endpoint
 * just flips the triggeredAnalysis flag so the banner stops appearing.
 *
 * Route file handles PATCH for idempotency.
 */
export async function PATCH(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  const existing = await prisma.arcAdvancementScan.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Scan not found' }, { status: 404 })

  const updated = await prisma.arcAdvancementScan.update({
    where: { id },
    data: { triggeredAnalysis: true },
  })

  return Response.json({ id: updated.id, triggeredAnalysis: updated.triggeredAnalysis })
}
