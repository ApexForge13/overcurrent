/**
 * POST /api/admin/triggers/[triggerId]/toggle
 *
 * Body: { enabled: boolean }
 * Effect: upserts TriggerEnablement row, busts the in-memory cache so
 * the next dispatcher tick sees the new state immediately.
 */

import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { clearEnablementCache } from '@/lib/gap-score/triggers/enablement'
import { TRIGGER_DEFINITIONS } from '@/lib/gap-score/triggers/registry'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ triggerId: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { triggerId } = await params
  if (!TRIGGER_DEFINITIONS[triggerId]) {
    return Response.json({ error: 'Unknown triggerId' }, { status: 404 })
  }

  let body: { enabled?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'Body must be { enabled: boolean }' }, { status: 400 })
  }

  const updated = await prisma.triggerEnablement.upsert({
    where: { triggerId },
    create: {
      triggerId,
      enabled: body.enabled,
      updatedBy: auth.user.email,
    },
    update: {
      enabled: body.enabled,
      updatedBy: auth.user.email,
    },
  })
  clearEnablementCache()
  return Response.json({ triggerId: updated.triggerId, enabled: updated.enabled })
}
