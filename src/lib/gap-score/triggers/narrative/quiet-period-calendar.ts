/**
 * Quiet-period calendar — FOMC + earnings windows for T-N2 suppression.
 *
 * Per manifest A7: FOMC dates are a hardcoded 12-month frozen array. Ops
 * refreshes annually. When today > last meeting date, a CostLog heartbeat
 * 'fomc-calendar-stale' is emitted so stale state is visible.
 *
 * Earnings quiet-period uses EarningsSchedule rows (populated by the
 * T-GT11 trigger). An entity is in its quiet period when an EarningsSchedule
 * row falls within a ±24h window around `now`. Both confirmed and
 * projected rows count — projected is better-than-nothing during ramp-up.
 */

import type { PrismaClient } from '@prisma/client'

const FOMC_QUIET_WINDOW_HOURS = 24
const EARNINGS_QUIET_WINDOW_HOURS = 24

/**
 * FOMC meeting dates — next 12 months from 2026-04-22 (Phase 1c.2b.2 ship
 * date). Update annually. Dates are at 14:00 UTC (approx 09:00 ET
 * statement release). Source: federalreserve.gov/monetarypolicy/fomccalendars.htm
 */
export const FOMC_MEETING_DATES: readonly string[] = Object.freeze([
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09',
  '2027-01-27',
  '2027-03-17',
  '2027-04-28',
])

/**
 * Most-recent FOMC date in the hardcoded array. Used by staleness check.
 */
export function lastKnownFomcDate(): Date {
  const iso = FOMC_MEETING_DATES[FOMC_MEETING_DATES.length - 1]
  return new Date(`${iso}T14:00:00Z`)
}

/**
 * Is `now` within FOMC_QUIET_WINDOW_HOURS of any hardcoded FOMC meeting?
 */
export function isInFomcQuietPeriod(now: Date): boolean {
  const nowMs = now.getTime()
  const windowMs = FOMC_QUIET_WINDOW_HOURS * 60 * 60 * 1000
  for (const iso of FOMC_MEETING_DATES) {
    const meetingMs = new Date(`${iso}T14:00:00Z`).getTime()
    if (Math.abs(nowMs - meetingMs) <= windowMs) return true
  }
  return false
}

/**
 * Check FOMC calendar staleness. Emits a CostLog warn heartbeat when
 * today is past the last known meeting. Dedupes per hour to avoid
 * log-spam. Returns { stale: boolean } for callers that want to branch.
 */
export async function maybeEmitFomcStaleHeartbeat(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ stale: boolean }> {
  const lastKnown = lastKnownFomcDate()
  if (now <= lastKnown) return { stale: false }

  const dedupCutoff = new Date(now.getTime() - 60 * 60 * 1000)
  const recent = await prisma.costLog.findFirst({
    where: {
      service: 'fomc-calendar',
      operation: 'fomc-calendar-stale',
      createdAt: { gte: dedupCutoff },
    },
    select: { id: true },
  })
  if (recent) return { stale: true }

  await prisma.costLog.create({
    data: {
      model: 'trigger_runner',
      agentType: 'calendar_stale_warn',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: 'fomc-calendar',
      operation: 'fomc-calendar-stale',
      metadata: {
        lastKnownFomcDate: lastKnown.toISOString(),
        now: now.toISOString(),
        message: 'FOMC_MEETING_DATES array is stale — update lastKnownFomcDate() annually',
      },
    },
  })
  return { stale: true }
}

/**
 * Given a set of entity IDs, return the subset that's currently in an
 * earnings quiet-period window. One DB query per call; cache at the
 * trigger level if the featured set grows large.
 */
export async function getEntitiesInEarningsQuietPeriod(
  prisma: PrismaClient,
  entityIds: string[],
  now: Date,
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set()
  const windowMs = EARNINGS_QUIET_WINDOW_HOURS * 60 * 60 * 1000
  const windowStart = new Date(now.getTime() - windowMs)
  const windowEnd = new Date(now.getTime() + windowMs)
  const rows = await prisma.earningsSchedule.findMany({
    where: {
      entityId: { in: entityIds },
      reportDate: { gte: windowStart, lte: windowEnd },
    },
    select: { entityId: true },
  })
  return new Set(rows.map((r) => r.entityId))
}
