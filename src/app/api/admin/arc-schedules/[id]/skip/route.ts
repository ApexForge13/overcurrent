import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

/**
 * POST /api/admin/arc-schedules/[id]/skip
 *
 * Body: { newScheduledFor: ISO-8601 string, reason?: string }
 *
 * Marks the schedule as skipped and creates a NEW pending schedule for the
 * same arc/umbrella/targetPhase at the new date. The original record preserves
 * skipReason and isSkipped=true as a historical audit trail.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  let body: { newScheduledFor?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.newScheduledFor) {
    return Response.json({ error: 'newScheduledFor required' }, { status: 400 })
  }
  const newDate = new Date(body.newScheduledFor)
  if (isNaN(newDate.getTime())) {
    return Response.json({ error: 'newScheduledFor must be a valid ISO-8601 date' }, { status: 400 })
  }

  const existing = await prisma.arcPhaseSchedule.findUnique({
    where: { id },
    select: {
      id: true,
      storyArcId: true,
      umbrellaArcId: true,
      targetPhase: true,
      status: true,
      isSkipped: true,
    },
  })
  if (!existing) {
    return Response.json({ error: 'Schedule not found' }, { status: 404 })
  }
  if (existing.status !== 'pending' || existing.isSkipped) {
    return Response.json(
      { error: 'Only pending, non-skipped schedules can be skipped' },
      { status: 400 },
    )
  }

  const [updated, created] = await prisma.$transaction([
    prisma.arcPhaseSchedule.update({
      where: { id },
      data: {
        isSkipped: true,
        status: 'skipped',
        skipReason: body.reason?.trim() || null,
      },
    }),
    prisma.arcPhaseSchedule.create({
      data: {
        storyArcId: existing.storyArcId,
        umbrellaArcId: existing.umbrellaArcId,
        targetPhase: existing.targetPhase,
        scheduledFor: newDate,
        status: 'pending',
        isSkipped: false,
      },
    }),
  ])

  return Response.json({
    skipped: {
      id: updated.id,
      status: updated.status,
      skipReason: updated.skipReason,
    },
    replacement: {
      id: created.id,
      scheduledFor: created.scheduledFor.toISOString(),
      targetPhase: created.targetPhase,
    },
  })
}
