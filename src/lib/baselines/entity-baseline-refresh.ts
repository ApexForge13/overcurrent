/**
 * EntityBaseline rolling-statistics refresher.
 *
 * Phase 1b scope: scaffold only. Refresher iterates over active entities,
 * queries ScoredSignal for per-metric observations in the rolling window,
 * and upserts EntityBaseline rows with computed stats + isMature flag.
 *
 * Because Phase 1b has no ScoredSignal data yet (scoring lands in Phase 2),
 * the refresher runs cleanly and writes rows with sampleCount=0,
 * isMature=false for every (entity, metric, window) combination. Once
 * Phase 1c/2 data starts flowing, the same refresher picks up the
 * observations and maturity flips as sample counts cross thresholds.
 *
 * The refresher is a pure function of (prisma, now) — no hidden state,
 * idempotent, safe to run concurrently with other refreshers (per-row
 * upserts use unique constraints).
 */

import type { PrismaClient } from '@prisma/client'
import { computeStats } from './stats'
import { isMature, minSampleSize, type MaturityMetric } from './maturity'

/**
 * Metrics refreshed per entity. Each has a window length in days.
 * Add new metrics here — `ScoredSignal.stream` + `signalType` filtering
 * lives inside `fetchObservations` below.
 */
export const ENTITY_METRICS: readonly {
  metric: MaturityMetric
  windowDays: number
  stream: 'narrative' | 'psychological' | 'ground_truth'
  signalType?: string
}[] = Object.freeze([
  { metric: 'article_volume_hourly',           windowDays: 7,  stream: 'narrative' },
  { metric: 'cashtag_velocity_hourly',         windowDays: 14, stream: 'psychological' },
  { metric: 'engagement_acceleration_minute',  windowDays: 1,  stream: 'psychological' },
  { metric: 'price_volatility_30d',            windowDays: 30, stream: 'ground_truth', signalType: 'price_move' },
])

export interface RefreshEntityBaselinesResult {
  entitiesProcessed: number
  rowsWritten: number
  matureCount: number
  immatureCount: number
  errors: Array<{ entityId: string; metric: string; error: string }>
}

export async function refreshEntityBaselines(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RefreshEntityBaselinesResult> {
  const result: RefreshEntityBaselinesResult = {
    entitiesProcessed: 0,
    rowsWritten: 0,
    matureCount: 0,
    immatureCount: 0,
    errors: [],
  }

  const entities = await prisma.trackedEntity.findMany({
    where: { active: true },
    select: { id: true },
  })
  result.entitiesProcessed = entities.length

  for (const entity of entities) {
    for (const spec of ENTITY_METRICS) {
      try {
        const windowStart = new Date(now.getTime() - spec.windowDays * 24 * 60 * 60 * 1000)
        const observations = await fetchEntityObservations(
          prisma,
          entity.id,
          spec.stream,
          spec.signalType,
          windowStart,
          now,
        )
        const stats = computeStats(observations)
        const metricFloor = minSampleSize(spec.metric)
        const mature = isMature(spec.metric, stats.count)

        await prisma.entityBaseline.upsert({
          where: {
            entityId_metricName_windowDays: {
              entityId: entity.id,
              metricName: spec.metric,
              windowDays: spec.windowDays,
            },
          },
          create: {
            entityId: entity.id,
            metricName: spec.metric,
            windowDays: spec.windowDays,
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
          entityId: entity.id,
          metric: spec.metric,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return result
}

/**
 * Observation fetcher — returns a numeric series for the given entity +
 * stream + window. Phase 1b implementation queries ScoredSignal; when the
 * table is empty (expected), returns []. Separate function so tests can
 * substitute a fake series without mocking Prisma.
 */
export async function fetchEntityObservations(
  prisma: PrismaClient,
  entityId: string,
  stream: 'narrative' | 'psychological' | 'ground_truth',
  signalType: string | undefined,
  windowStart: Date,
  windowEnd: Date,
): Promise<number[]> {
  const signals = await prisma.scoredSignal.findMany({
    where: {
      entityId,
      stream,
      ...(signalType ? { signalType } : {}),
      publishedAt: { gte: windowStart, lte: windowEnd },
    },
    select: { direction: true, confidence: true },
  })
  // For price_volatility_30d the "observation" is the absolute direction;
  // for volume metrics the count itself IS the observation. Phase 1c
  // refactors this once real signal shapes stabilize; for Phase 1b we
  // simply return |direction| as a placeholder numeric series.
  return signals.map((s) => Math.abs(s.direction))
}
