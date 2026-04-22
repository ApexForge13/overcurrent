/**
 * Psychological baseline recomputation.
 *
 * Two metrics:
 *   - cashtag_velocity_hourly: rolling 14-day mean+stddev on hourly
 *     cashtag mention count. minSampleSize 240.
 *   - engagement_hourly: rolling 4-hour comparison (last-hour rate vs
 *     previous-hour rate) — handled differently from the other metrics
 *     because T-P2 is an acceleration trigger, not z-score. Baseline
 *     worker tracks the hourly engagement sum per entity; trigger-side
 *     logic computes the ratio at fire time.
 *
 * Lazy: no row created until first observation.
 */

import type { PrismaClient } from '@prisma/client'
import { truncateToHour } from '@/lib/gap-score/narrative/observation-aggregator'
import { computeStats } from '@/lib/gap-score/narrative/narrative-baseline-worker'

const METRIC_CASHTAG = 'cashtag_velocity_hourly'
const WINDOW_DAYS_CASHTAG = 14
const MIN_SAMPLE_CASHTAG = 240

export interface PsychBaselineRecomputeResult {
  cashtagEntitiesEvaluated: number
  cashtagBaselinesUpserted: number
  cashtagMaturityFlipped: number
}

export async function recomputePsychBaselines(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PsychBaselineRecomputeResult> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS_CASHTAG * 24 * 60 * 60 * 1000)
  const truncatedNow = truncateToHour(now)

  const rollups = await prisma.entityObservationHourly.findMany({
    where: {
      metricName: METRIC_CASHTAG,
      hourStart: { gte: windowStart, lte: truncatedNow },
    },
    select: { entityId: true, count: true },
  })

  const byEntity = new Map<string, number[]>()
  for (const r of rollups) {
    const bucket = byEntity.get(r.entityId) ?? []
    bucket.push(r.count)
    byEntity.set(r.entityId, bucket)
  }

  let cashtagBaselinesUpserted = 0
  let cashtagMaturityFlipped = 0

  for (const [entityId, counts] of byEntity.entries()) {
    const stats = computeStats(counts)
    const existing = await prisma.entityBaseline.findUnique({
      where: {
        entityId_metricName_windowDays: {
          entityId,
          metricName: METRIC_CASHTAG,
          windowDays: WINDOW_DAYS_CASHTAG,
        },
      },
      select: { isMature: true },
    })
    const wasMature = existing?.isMature ?? false
    const isMatureNow = stats.sampleCount >= MIN_SAMPLE_CASHTAG

    await prisma.entityBaseline.upsert({
      where: {
        entityId_metricName_windowDays: {
          entityId,
          metricName: METRIC_CASHTAG,
          windowDays: WINDOW_DAYS_CASHTAG,
        },
      },
      create: {
        entityId,
        metricName: METRIC_CASHTAG,
        windowDays: WINDOW_DAYS_CASHTAG,
        mean: stats.mean,
        stddev: stats.stddev,
        sampleCount: stats.sampleCount,
        minSampleSize: MIN_SAMPLE_CASHTAG,
        isMature: isMatureNow,
      },
      update: {
        mean: stats.mean,
        stddev: stats.stddev,
        sampleCount: stats.sampleCount,
        isMature: isMatureNow,
      },
    })
    cashtagBaselinesUpserted++
    if (!wasMature && isMatureNow) cashtagMaturityFlipped++
  }

  return {
    cashtagEntitiesEvaluated: byEntity.size,
    cashtagBaselinesUpserted,
    cashtagMaturityFlipped,
  }
}
