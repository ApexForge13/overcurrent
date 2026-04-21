/**
 * ZoneBaseline rolling-statistics refresher.
 *
 * Same shape as refreshEntityBaselines — iterates zones × metrics,
 * upserts ZoneBaseline rows. Phase 1b has no observation data yet
 * (ZoneObservation table + ingestion land in Phase 1c), so all rows
 * stay at sampleCount=0, isMature=false until then.
 *
 * Zones are hardcoded in src/lib/gap-score/zones/tier-1-zones.ts
 * (not a DB table). The refresher iterates the imported TIER_1_ZONES.
 */

import type { PrismaClient } from '@prisma/client'
import { TIER_1_ZONES, ZONE_METRIC_NAMES, type ZoneMetricName } from '@/lib/gap-score/zones/tier-1-zones'
import { computeStats } from './stats'
import { isMature, minSampleSize } from './maturity'

const ZONE_WINDOW_DAYS = 30

export interface RefreshZoneBaselinesResult {
  zonesProcessed: number
  rowsWritten: number
  matureCount: number
  immatureCount: number
  errors: Array<{ zoneId: string; metric: string; error: string }>
}

export async function refreshZoneBaselines(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RefreshZoneBaselinesResult> {
  const result: RefreshZoneBaselinesResult = {
    zonesProcessed: TIER_1_ZONES.length,
    rowsWritten: 0,
    matureCount: 0,
    immatureCount: 0,
    errors: [],
  }

  for (const zone of TIER_1_ZONES) {
    for (const metric of ZONE_METRIC_NAMES) {
      try {
        const observations = await fetchZoneObservations(
          prisma,
          zone.id,
          metric,
          ZONE_WINDOW_DAYS,
          now,
        )
        const stats = computeStats(observations)
        const metricFloor = minSampleSize(metric)
        const mature = isMature(metric, stats.count)

        await prisma.zoneBaseline.upsert({
          where: {
            zoneId_metricName_windowDays: {
              zoneId: zone.id,
              metricName: metric,
              windowDays: ZONE_WINDOW_DAYS,
            },
          },
          create: {
            zoneId: zone.id,
            metricName: metric,
            windowDays: ZONE_WINDOW_DAYS,
            mean: stats.mean,
            stddev: stats.stddev,
            sampleCount: stats.count,
            minSampleSize: metricFloor,
            isMature: mature,
          },
          update: {
            mean: stats.mean,
            stddev: stats.stddev,
            sampleCount: stats.count,
            minSampleSize: metricFloor,
            isMature: mature,
            computedAt: now,
          },
        })

        result.rowsWritten++
        if (mature) result.matureCount++
        else result.immatureCount++
      } catch (err) {
        result.errors.push({
          zoneId: zone.id,
          metric,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return result
}

/**
 * Fetches zone observations for a metric within the rolling window.
 *
 * Phase 1b: ZoneObservation table doesn't exist yet (lands in Phase 1c
 * with the AIS ingestion). This function returns [] as a safe default,
 * which correctly produces a sampleCount=0 / isMature=false baseline row.
 * Replace with actual fetch when the table is created.
 */
export async function fetchZoneObservations(
  _prisma: PrismaClient,
  _zoneId: string,
  _metric: ZoneMetricName,
  _windowDays: number,
  _now: Date,
): Promise<number[]> {
  // Phase 1b: no source table. Phase 1c replaces with:
  //   const obs = await prisma.zoneObservation.findMany({ where: {...} })
  //   return obs.map(o => o[metric])
  return []
}
