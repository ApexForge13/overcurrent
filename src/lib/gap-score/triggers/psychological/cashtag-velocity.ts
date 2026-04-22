/**
 * T-P1 — cashtag velocity spike (psychological stream).
 *
 * Fires when current-hour cashtag mention count exceeds
 * mean + 3σ over 14-day baseline AND ≥20 mentions in the hour.
 * Severity = z-score / 5, capped at 1.0.
 * Direction = 0 (downstream sentiment scoring).
 *
 * Baseline maturity gate: EntityBaseline.isMature=true required
 * (sampleCount >= 240). Calibrating entities don't fire.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { truncateToHour } from '@/lib/gap-score/narrative/observation-aggregator'

const TRIGGER_ID = 'T-P1'
const METRIC_NAME = 'cashtag_velocity_hourly'
const WINDOW_DAYS = 14
const Z_FLOOR = 3
const ABSOLUTE_FLOOR = 20
const Z_SEVERITY_CAP = 5

export async function cashtagVelocityTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const currentHour = truncateToHour(ctx.now)
  const currentRollups = await ctx.prisma.entityObservationHourly.findMany({
    where: {
      metricName: METRIC_NAME,
      hourStart: currentHour,
      count: { gte: ABSOLUTE_FLOOR },
    },
    select: { entityId: true, count: true },
  })
  if (currentRollups.length === 0) return []

  const entityIds = currentRollups.map((r) => r.entityId)
  const baselines = await ctx.prisma.entityBaseline.findMany({
    where: {
      entityId: { in: entityIds },
      metricName: METRIC_NAME,
      windowDays: WINDOW_DAYS,
      isMature: true,
    },
    select: { entityId: true, mean: true, stddev: true },
  })
  const byEntity = new Map(baselines.map((b) => [b.entityId, b]))

  const fires: TriggerFireEvent[] = []
  for (const rollup of currentRollups) {
    const baseline = byEntity.get(rollup.entityId)
    if (!baseline) continue
    if (baseline.stddev <= 0) continue
    const z = (rollup.count - baseline.mean) / baseline.stddev
    if (z <= Z_FLOOR) continue

    const severity = Math.min(z / Z_SEVERITY_CAP, 1.0)
    fires.push({
      entityId: rollup.entityId,
      triggerType: TRIGGER_ID,
      stream: 'psychological',
      severity,
      metadata: {
        current_count: rollup.count,
        baseline_mean: baseline.mean,
        baseline_stddev: baseline.stddev,
        z_score: z,
        hour_start: currentHour.toISOString(),
        direction: 0,
      },
    })
  }
  return fires
}
