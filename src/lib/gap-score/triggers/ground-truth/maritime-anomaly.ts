/**
 * T-GT7 — maritime AIS anomaly (Tier-1 zones only).
 *
 * Runs the zone scanner, then for each successful zone scan compares
 * each metric (tankerCount, containerShipCount, bulkCarrierCount,
 * lngCarrierCount) against the corresponding ZoneBaseline. Fires when
 * |z| > 2 AND the baseline is mature (sampleCount >= 90).
 *
 * Direction mapping per zone category:
 *   crude_export + buildup   → -1 (oversupply)
 *   crude_export + drawdown  → +1 (tight supply)
 *   crude_import + buildup   → +1 (demand arriving)
 *   crude_import + drawdown  → -1 (demand soft)
 *   chokepoint + anomaly     → 0 (disruption, high severity regardless)
 *   others                   → 0 (defer to Phase 2)
 *
 * Rescored entities come from zone.relevantCommodities — one fire per
 * (commodityEntity × zoneMetric) tuple.
 *
 * Double-gated by the scanner; if scanning is disabled, scanner returns
 * no scans and this trigger naturally returns [].
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { runMaritimeZoneScan, type ZoneScanResult } from './maritime-zone-scanner'
import { TIER_1_ZONES, type MonitoringZone } from '@/lib/gap-score/zones/tier-1-zones'

const TRIGGER_ID = 'T-GT7'
const Z_FLOOR = 2

/**
 * Anomaly direction per zone category + observation direction
 * (buildup = observation above mean, drawdown = below).
 */
export function classifyZoneAnomalyDirection(
  category: MonitoringZone['category'],
  direction: 'buildup' | 'drawdown',
): -1 | 0 | 1 {
  if (category === 'crude_export') return direction === 'buildup' ? -1 : 1
  if (category === 'crude_import') return direction === 'buildup' ? 1 : -1
  if (category === 'chokepoint') return 0 // high severity regardless
  return 0
}

export async function maritimeAnomalyTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const summary = await runMaritimeZoneScan(ctx.prisma, ctx.now)
  if (summary.scans.length === 0) return []

  // Load baselines for the scanned zones
  const scannedZoneIds = summary.scans.map((s) => s.zoneId)
  const baselines = await ctx.prisma.zoneBaseline.findMany({
    where: {
      zoneId: { in: scannedZoneIds },
      windowDays: 30,
      isMature: true,
    },
    select: { zoneId: true, metricName: true, mean: true, stddev: true },
  })

  // Index by (zoneId, metricName)
  const baselineMap = new Map<string, { mean: number; stddev: number }>()
  for (const b of baselines) {
    baselineMap.set(`${b.zoneId}|${b.metricName}`, { mean: b.mean, stddev: b.stddev })
  }

  // Index zones by id for category + relevantCommodities lookup
  const zoneMap = new Map(TIER_1_ZONES.map((z) => [z.id, z]))

  // Resolve commodities to TrackedEntity once
  const allCommodities = new Set<string>()
  for (const scan of summary.scans) {
    const zone = zoneMap.get(scan.zoneId)
    if (zone) for (const c of zone.relevantCommodities) allCommodities.add(c)
  }
  const entities = allCommodities.size
    ? await ctx.prisma.trackedEntity.findMany({
        where: { identifier: { in: Array.from(allCommodities) }, active: true },
        select: { id: true, identifier: true },
      })
    : []
  const entityByIdentifier = new Map(entities.map((e) => [e.identifier, e.id]))

  const fires: TriggerFireEvent[] = []

  for (const scan of summary.scans) {
    const zone = zoneMap.get(scan.zoneId)
    if (!zone) continue

    const metrics: Array<{ metricName: keyof ZoneScanResult; observation: number }> = [
      { metricName: 'tankerCount', observation: scan.tankerCount },
      { metricName: 'containerShipCount', observation: scan.containerShipCount },
      { metricName: 'bulkCarrierCount', observation: scan.bulkCarrierCount },
      { metricName: 'lngCarrierCount', observation: scan.lngCarrierCount },
    ]

    for (const { metricName, observation } of metrics) {
      const baseline = baselineMap.get(`${scan.zoneId}|${metricName}`)
      if (!baseline) continue // immature baseline
      if (baseline.stddev <= 0) continue // degenerate
      const z = (observation - baseline.mean) / baseline.stddev
      if (Math.abs(z) < Z_FLOOR) continue

      const anomalyDir = z > 0 ? 'buildup' : 'drawdown'
      const direction = classifyZoneAnomalyDirection(zone.category, anomalyDir)
      const severity = Math.min(Math.abs(z) / 4, 1.0)

      // One fire per relevant commodity
      for (const commodity of zone.relevantCommodities) {
        const entityId = entityByIdentifier.get(commodity)
        if (!entityId) continue
        fires.push({
          entityId,
          triggerType: TRIGGER_ID,
          stream: 'ground_truth',
          severity,
          metadata: {
            zone_id: scan.zoneId,
            zone_name: zone.name,
            zone_category: zone.category,
            metric: metricName,
            observation,
            baseline_mean: baseline.mean,
            baseline_stddev: baseline.stddev,
            z_score: z,
            anomaly_direction: anomalyDir,
            direction,
          },
        })
      }
    }
  }

  return fires
}
