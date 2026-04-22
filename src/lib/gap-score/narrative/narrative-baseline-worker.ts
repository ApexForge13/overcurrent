/**
 * Narrative baseline recomputation.
 *
 * For each entity with `article_volume_hourly` observations in the prior
 * 7 days, compute rolling mean + stddev of hourly counts and upsert the
 * matching EntityBaseline row. Flips `isMature` when sampleCount >=
 * MIN_SAMPLE_SIZE (120 hourly obs, per Phase 1 addendum A1.1).
 *
 * Called hourly from the baseline worker (pipeline-service/baseline-worker.ts).
 * Writes one EntityBaseline row per (entityId, metricName='article_volume_hourly',
 * windowDays=7).
 */

import type { PrismaClient } from '@prisma/client'
import { truncateToHour } from './observation-aggregator'

const METRIC_NAME = 'article_volume_hourly'
const WINDOW_DAYS = 7
const MIN_SAMPLE_SIZE = 120

export interface BaselineRecomputeResult {
  entitiesEvaluated: number
  baselinesUpserted: number
  maturityFlipped: number
}

/**
 * Recompute the article_volume_hourly baseline for all entities with any
 * hourly rollup in the past `WINDOW_DAYS` days. Lazy-create approach:
 * entities with zero observations don't get a baseline row (saves space).
 */
export async function recomputeNarrativeBaselines(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<BaselineRecomputeResult> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const truncatedNow = truncateToHour(now)

  const rollups = await prisma.entityObservationHourly.findMany({
    where: {
      metricName: METRIC_NAME,
      hourStart: { gte: windowStart, lte: truncatedNow },
    },
    select: { entityId: true, count: true },
  })

  // Bucket by entity
  const byEntity = new Map<string, number[]>()
  for (const r of rollups) {
    const bucket = byEntity.get(r.entityId) ?? []
    bucket.push(r.count)
    byEntity.set(r.entityId, bucket)
  }

  let baselinesUpserted = 0
  let maturityFlipped = 0

  for (const [entityId, counts] of byEntity.entries()) {
    const stats = computeStats(counts)
    const wasMatureBefore = await isMatureBefore(prisma, entityId)
    const isMatureNow = stats.sampleCount >= MIN_SAMPLE_SIZE

    await prisma.entityBaseline.upsert({
      where: {
        entityId_metricName_windowDays: {
          entityId,
          metricName: METRIC_NAME,
          windowDays: WINDOW_DAYS,
        },
      },
      create: {
        entityId,
        metricName: METRIC_NAME,
        windowDays: WINDOW_DAYS,
        mean: stats.mean,
        stddev: stats.stddev,
        sampleCount: stats.sampleCount,
        minSampleSize: MIN_SAMPLE_SIZE,
        isMature: isMatureNow,
      },
      update: {
        mean: stats.mean,
        stddev: stats.stddev,
        sampleCount: stats.sampleCount,
        isMature: isMatureNow,
      },
    })
    baselinesUpserted++
    if (!wasMatureBefore && isMatureNow) maturityFlipped++
  }

  return {
    entitiesEvaluated: byEntity.size,
    baselinesUpserted,
    maturityFlipped,
  }
}

async function isMatureBefore(prisma: PrismaClient, entityId: string): Promise<boolean> {
  const row = await prisma.entityBaseline.findUnique({
    where: {
      entityId_metricName_windowDays: {
        entityId,
        metricName: METRIC_NAME,
        windowDays: WINDOW_DAYS,
      },
    },
    select: { isMature: true },
  })
  return row?.isMature ?? false
}

export function computeStats(values: number[]): {
  mean: number
  stddev: number
  sampleCount: number
} {
  if (values.length === 0) return { mean: 0, stddev: 0, sampleCount: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  const stddev = Math.sqrt(variance)
  return { mean, stddev, sampleCount: values.length }
}
