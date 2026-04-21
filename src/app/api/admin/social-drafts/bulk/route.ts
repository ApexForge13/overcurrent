import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

export async function PUT(request: Request) {
  if (!featureFlags.SOCIAL_AUTOMATION_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let ids: string[]
  let action: string
  let scheduledFor: string | undefined

  try {
    const body = await request.json()
    ids = body.ids
    action = body.action
    scheduledFor = body.scheduledFor
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'ids array required' }, { status: 400 })
  }

  if (!ids.every((id: unknown) => typeof id === 'string')) {
    return Response.json({ error: 'All ids must be strings' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (action === 'approve') data.status = 'approved'
  else if (action === 'reject') data.status = 'rejected'
  else if (action === 'schedule') {
    data.status = 'scheduled'
    data.scheduledFor = scheduledFor ? new Date(scheduledFor) : null
  } else {
    return Response.json({ error: 'Invalid action' }, { status: 400 })
  }

  const result = await prisma.socialDraft.updateMany({ where: { id: { in: ids } }, data })
  return Response.json({ updated: result.count })
}
