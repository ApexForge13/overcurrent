/**
 * T-P2 — engagement velocity acceleration (psychological stream).
 *
 * Fires when last-hour engagement rate >= 2× previous-hour rate AND
 * total engagement >= 100 events in the last hour.
 * Severity = acceleration-factor scaled (2× → 0.5, 5×+ → 1.0).
 * Direction = 0 (determined downstream).
 *
 * Reads engagement_hourly rollups (sum of likes+comments+replies per hour).
 * No baseline required — ratio-based trigger.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { truncateToHour } from '@/lib/gap-score/narrative/observation-aggregator'

const TRIGGER_ID = 'T-P2'
const METRIC_NAME = 'engagement_hourly'
const MIN_ACCELERATION = 2
const MIN_LAST_HOUR_ENGAGEMENT = 100
const ACCELERATION_SEVERITY_CAP = 5

export async function engagementVelocityTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const lastHourStart = truncateToHour(new Date(ctx.now.getTime() - 60 * 60 * 1000))
  const prevHourStart = truncateToHour(new Date(ctx.now.getTime() - 2 * 60 * 60 * 1000))

  // Pull last-hour + previous-hour rollups.
  const rollups = await ctx.prisma.entityObservationHourly.findMany({
    where: {
      metricName: METRIC_NAME,
      hourStart: { in: [lastHourStart, prevHourStart] },
    },
    select: { entityId: true, hourStart: true, engagementSum: true },
  })

  const lastHourByEntity = new Map<string, number>()
  const prevHourByEntity = new Map<string, number>()
  for (const r of rollups) {
    const sum = r.engagementSum ?? 0
    if (r.hourStart.getTime() === lastHourStart.getTime()) {
      lastHourByEntity.set(r.entityId, sum)
    } else if (r.hourStart.getTime() === prevHourStart.getTime()) {
      prevHourByEntity.set(r.entityId, sum)
    }
  }

  // Dedupe against recent T-P2 fires in the last 2h
  const recentFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: prevHourStart, lte: ctx.now },
    },
    select: { entityId: true },
  })
  const alreadyFired = new Set(recentFires.map((f) => f.entityId))

  const fires: TriggerFireEvent[] = []
  for (const [entityId, lastHourSum] of lastHourByEntity.entries()) {
    if (lastHourSum < MIN_LAST_HOUR_ENGAGEMENT) continue
    if (alreadyFired.has(entityId)) continue
    const prevHourSum = prevHourByEntity.get(entityId) ?? 0
    // Denominator floor to avoid div-by-zero blowouts. If prev hour was
    // zero, treat as prev=1 for acceleration calc — this gives enormous
    // acceleration factors but the severity is capped anyway.
    const denom = Math.max(prevHourSum, 1)
    const acceleration = lastHourSum / denom
    if (acceleration < MIN_ACCELERATION) continue

    // Severity: 2× → 0.5, 5× → 1.0 (linear)
    const above = acceleration - MIN_ACCELERATION
    const range = ACCELERATION_SEVERITY_CAP - MIN_ACCELERATION
    const severity = Math.min(0.5 + (above / range) * 0.5, 1.0)

    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'psychological',
      severity,
      metadata: {
        last_hour_engagement: lastHourSum,
        prev_hour_engagement: prevHourSum,
        acceleration_factor: acceleration,
        last_hour_start: lastHourStart.toISOString(),
        direction: 0,
      },
    })
  }
  return fires
}
