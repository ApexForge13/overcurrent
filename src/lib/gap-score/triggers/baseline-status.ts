/**
 * Baseline maturity status for the admin UI.
 *
 * Returns EntityBaseline + ZoneBaseline rows sorted by (isMature asc,
 * sampleCount desc) so the UI can surface calibrating-closest-to-mature
 * entities at the top.
 */

import type { PrismaClient } from '@prisma/client'

export interface EntityBaselineStatus {
  entityId: string
  identifier: string
  metricName: string
  windowDays: number
  sampleCount: number
  minSampleSize: number
  isMature: boolean
  maturityPct: number // 0.0 — 1.0
}

export interface ZoneBaselineStatus {
  zoneId: string
  metricName: string
  windowDays: number
  sampleCount: number
  minSampleSize: number
  isMature: boolean
  maturityPct: number
}

/**
 * Top N entity baselines by (immature first, sampleCount desc) — gives
 * ops the "closest to maturing" view first, plus the mature ones
 * afterward.
 */
export async function getEntityBaselineStatus(
  prisma: PrismaClient,
  limit = 50,
): Promise<EntityBaselineStatus[]> {
  const rows = await prisma.entityBaseline.findMany({
    select: {
      entityId: true,
      metricName: true,
      windowDays: true,
      sampleCount: true,
      minSampleSize: true,
      isMature: true,
      entity: { select: { identifier: true } },
    },
    orderBy: [{ isMature: 'asc' }, { sampleCount: 'desc' }],
    take: limit,
  })
  return rows.map((r) => ({
    entityId: r.entityId,
    identifier: r.entity.identifier,
    metricName: r.metricName,
    windowDays: r.windowDays,
    sampleCount: r.sampleCount,
    minSampleSize: r.minSampleSize,
    isMature: r.isMature,
    maturityPct:
      r.minSampleSize > 0
        ? Math.min(r.sampleCount / r.minSampleSize, 1.0)
        : r.isMature
          ? 1.0
          : 0,
  }))
}

/**
 * Zone baselines. All returned (only 43 × 4 metrics = ~172 rows max;
 * small enough to render everything).
 */
export async function getZoneBaselineStatus(
  prisma: PrismaClient,
): Promise<ZoneBaselineStatus[]> {
  const rows = await prisma.zoneBaseline.findMany({
    select: {
      zoneId: true,
      metricName: true,
      windowDays: true,
      sampleCount: true,
      minSampleSize: true,
      isMature: true,
    },
    orderBy: [{ isMature: 'asc' }, { sampleCount: 'desc' }],
  })
  return rows.map((r) => ({
    ...r,
    maturityPct:
      r.minSampleSize > 0
        ? Math.min(r.sampleCount / r.minSampleSize, 1.0)
        : r.isMature
          ? 1.0
          : 0,
  }))
}
