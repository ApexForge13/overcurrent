/**
 * T-N1 — article volume spike (narrative stream).
 *
 * Fires when current-hour article count for an entity exceeds
 * mean + 2σ over the 7-day hourly baseline AND ≥5 articles in the hour.
 * Severity = z-score / 4, capped at 1.0.
 * Direction = 0 (determined downstream by sentiment scoring).
 *
 * Requires EntityBaseline.isMature=true. Entities in calibrating state
 * accumulate observations but don't fire.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { truncateToHour } from '@/lib/gap-score/narrative/observation-aggregator'

const TRIGGER_ID = 'T-N1'
const METRIC_NAME = 'article_volume_hourly'
const WINDOW_DAYS = 7
const Z_FLOOR = 2
const ABSOLUTE_FLOOR = 5
const Z_SEVERITY_CAP = 4

export async function articleVolumeSpikeTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const currentHour = truncateToHour(ctx.now)
  // Get current-hour rollup for all entities with baselines + rollup in this hour.
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
  const baselineByEntity = new Map(baselines.map((b) => [b.entityId, b]))

  const fires: TriggerFireEvent[] = []
  for (const rollup of currentRollups) {
    const baseline = baselineByEntity.get(rollup.entityId)
    if (!baseline) continue // immature baseline — skip
    if (baseline.stddev <= 0) continue // degenerate baseline — skip
    const z = (rollup.count - baseline.mean) / baseline.stddev
    if (z <= Z_FLOOR) continue

    const severity = Math.min(z / Z_SEVERITY_CAP, 1.0)
    fires.push({
      entityId: rollup.entityId,
      triggerType: TRIGGER_ID,
      stream: 'narrative',
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
