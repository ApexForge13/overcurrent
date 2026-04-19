import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import type { Prisma } from '@prisma/client'

type ScheduleWithRefs = Prisma.ArcPhaseScheduleGetPayload<{
  include: {
    umbrellaArc: { select: { id: true; name: true; signalCategory: true } }
    storyArc: {
      select: {
        id: true
        arcLabel: true
        arcPhaseAtCreation: true
        headline: true
        searchQuery: true
        storyClusterId: true
      }
    }
  }
}>

/**
 * GET /api/admin/arc-schedules
 *
 * Returns pending ArcPhaseSchedule records grouped into three buckets:
 *   - overdue    (scheduledFor < now, sorted oldest first)
 *   - dueToday   (scheduledFor within today — today's 0:00 to 23:59:59)
 *   - upcoming   (scheduledFor within next 7 days)
 *
 * Each item is enriched with:
 *   - umbrella { id, name, signalCategory }
 *   - arc      { id, storyId, arcLabel, arcPhaseAtCreation (most-recent-analyzed phase) }
 *
 * Non-skipped pending records only. Skipped records are excluded from all buckets.
 */
export async function GET(_request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const now = new Date()
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Pull all pending, non-skipped schedules within the 7-day window (+ all overdue)
  const schedules = await prisma.arcPhaseSchedule.findMany({
    where: {
      status: 'pending',
      isSkipped: false,
      scheduledFor: { lte: in7Days },
    },
    orderBy: { scheduledFor: 'asc' },
    include: {
      umbrellaArc: {
        select: { id: true, name: true, signalCategory: true },
      },
      storyArc: {
        select: {
          id: true,
          arcLabel: true,
          arcPhaseAtCreation: true,
          headline: true,
          searchQuery: true,
          storyClusterId: true,
        },
      },
    },
  })

  const overdue = schedules.filter(s => s.scheduledFor < now)
  const dueToday = schedules.filter(s => s.scheduledFor >= now && s.scheduledFor <= endOfToday)
  const upcoming = schedules.filter(s => s.scheduledFor > endOfToday && s.scheduledFor <= in7Days)

  return Response.json({
    overdue: overdue.map(serialize),
    dueToday: dueToday.map(serialize),
    upcoming: upcoming.map(serialize),
    counts: {
      overdue: overdue.length,
      dueToday: dueToday.length,
      upcoming: upcoming.length,
    },
    now: now.toISOString(),
  })
}

function serialize(s: ScheduleWithRefs) {
  const daysFromNow = (s.scheduledFor.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  return {
    id: s.id,
    targetPhase: s.targetPhase,
    scheduledFor: s.scheduledFor.toISOString(),
    daysUntilDue: Number(daysFromNow.toFixed(1)),
    daysOverdue: daysFromNow < 0 ? Math.abs(Number(daysFromNow.toFixed(1))) : 0,
    umbrella: s.umbrellaArc
      ? {
          id: s.umbrellaArc.id,
          name: s.umbrellaArc.name,
          signalCategory: s.umbrellaArc.signalCategory,
        }
      : null,
    arc: s.storyArc
      ? {
          storyId: s.storyArc.id,
          arcLabel: s.storyArc.arcLabel,
          currentPhase: s.storyArc.arcPhaseAtCreation,
          headline: s.storyArc.headline,
          searchQuery: s.storyArc.searchQuery,
          storyClusterId: s.storyArc.storyClusterId,
        }
      : null,
  }
}
