/**
 * Baseline maturity gate.
 *
 * For triggers that `requiresBaseline`, checks the corresponding
 * EntityBaseline / ZoneBaseline `isMature` flag. Immature baselines → no
 * fire, visible to admin as "calibrating" state.
 *
 * Phase 1c.1 event-driven triggers (SEC, Congress, META) don't require
 * baseline maturity, so this gate is a no-op for them. Phase 1c.2's
 * continuous triggers (article volume, cashtag velocity, etc.) consult
 * this gate heavily.
 */

import type { PrismaClient } from '@prisma/client'

export async function isEntityMetricMature(
  prisma: PrismaClient,
  entityId: string,
  metricName: string,
  windowDays: number,
): Promise<boolean> {
  const row = await prisma.entityBaseline.findUnique({
    where: {
      entityId_metricName_windowDays: { entityId, metricName, windowDays },
    },
    select: { isMature: true },
  })
  return row?.isMature === true
}

export async function isZoneMetricMature(
  prisma: PrismaClient,
  zoneId: string,
  metricName: string,
  windowDays: number,
): Promise<boolean> {
  const row = await prisma.zoneBaseline.findUnique({
    where: {
      zoneId_metricName_windowDays: { zoneId, metricName, windowDays },
    },
    select: { isMature: true },
  })
  return row?.isMature === true
}
