/**
 * Promote EntityObservation rows into EntityObservationHourly rollups.
 *
 * Idempotent — re-running over the same window re-computes the same
 * counts (upserts by unique constraint on entityId+metricName+hourStart).
 *
 * Called by the baseline worker before recomputing baselines, so the
 * hourly table is always fresh relative to the raw observation stream.
 *
 * Metric names:
 *   article_volume_hourly — from sourceType in {gdelt_article, rss_article}
 *   cashtag_velocity_hourly — from sourceType in {reddit_post, twitter_post}
 *   engagement_hourly — sum of engagement from psych sources
 */

import type { PrismaClient } from '@prisma/client'

const NARRATIVE_SOURCE_TYPES = ['gdelt_article', 'rss_article']
const PSYCH_SOURCE_TYPES = ['reddit_post', 'twitter_post']

export function truncateToHour(date: Date): Date {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d
}

export async function aggregateObservationsForWindow(
  prisma: PrismaClient,
  windowStart: Date,
  windowEnd: Date,
): Promise<{
  narrativeRows: number
  psychRows: number
}> {
  const hourStart = truncateToHour(windowStart)
  const hourEnd = truncateToHour(windowEnd)

  const narrativeRows = await aggregateMetric(
    prisma,
    'article_volume_hourly',
    NARRATIVE_SOURCE_TYPES,
    hourStart,
    hourEnd,
    false,
  )
  const psychRows = await aggregateMetric(
    prisma,
    'cashtag_velocity_hourly',
    PSYCH_SOURCE_TYPES,
    hourStart,
    hourEnd,
    false,
  )
  // engagement_hourly needs engagement sum — separate call with sum flag.
  await aggregateMetric(
    prisma,
    'engagement_hourly',
    PSYCH_SOURCE_TYPES,
    hourStart,
    hourEnd,
    true,
  )

  return { narrativeRows, psychRows }
}

async function aggregateMetric(
  prisma: PrismaClient,
  metricName: string,
  sourceTypes: string[],
  hourStart: Date,
  hourEnd: Date,
  includeEngagementSum: boolean,
): Promise<number> {
  // Bucket by (entityId, truncated hour). Using Prisma group-by on a raw
  // DATE_TRUNC requires $queryRaw; easier to compute in-memory since the
  // observation stream for one-hour-wide windows is small.
  const obs = await prisma.entityObservation.findMany({
    where: {
      sourceType: { in: sourceTypes },
      observedAt: { gte: hourStart, lt: new Date(hourEnd.getTime() + 60 * 60 * 1000) },
    },
    select: { entityId: true, observedAt: true, engagement: true },
  })

  const buckets = new Map<string, { count: number; engagementSum: number }>()
  for (const o of obs) {
    const bucketHour = truncateToHour(o.observedAt)
    const key = `${o.entityId}|${bucketHour.toISOString()}`
    const b = buckets.get(key) ?? { count: 0, engagementSum: 0 }
    b.count += 1
    if (typeof o.engagement === 'number') b.engagementSum += o.engagement
    buckets.set(key, b)
  }

  let upserted = 0
  for (const [key, b] of buckets.entries()) {
    const [entityId, hourIso] = key.split('|')
    const hour = new Date(hourIso)
    await prisma.entityObservationHourly.upsert({
      where: {
        entityId_metricName_hourStart: {
          entityId,
          metricName,
          hourStart: hour,
        },
      },
      create: {
        entityId,
        metricName,
        hourStart: hour,
        count: b.count,
        engagementSum: includeEngagementSum ? b.engagementSum : null,
      },
      update: {
        count: b.count,
        engagementSum: includeEngagementSum ? b.engagementSum : null,
      },
    })
    upserted++
  }
  return upserted
}
