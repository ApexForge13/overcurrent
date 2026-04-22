/**
 * Firing-rate statistics for the admin /admin/triggers UI.
 *
 * Returns per-trigger counts of TriggerEvent rows across 24h, 7d, 30d
 * windows + last-fired timestamp. Single query using aggregation for
 * efficiency at 16+ trigger × production-event-rate scale.
 */

import type { PrismaClient } from '@prisma/client'

export interface TriggerFiringStats {
  triggerType: string
  fires24h: number
  fires7d: number
  fires30d: number
  lastFiredAt: Date | null
}

export async function getFiringStats(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<Map<string, TriggerFiringStats>> {
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Three groupBy calls + one max lookup. Each is cheap with the
  // (triggerType, firedAt) index on TriggerEvent.
  const [count24h, count7d, count30d, latest] = await Promise.all([
    prisma.triggerEvent.groupBy({
      by: ['triggerType'],
      where: { firedAt: { gte: h24 } },
      _count: { _all: true },
    }),
    prisma.triggerEvent.groupBy({
      by: ['triggerType'],
      where: { firedAt: { gte: d7 } },
      _count: { _all: true },
    }),
    prisma.triggerEvent.groupBy({
      by: ['triggerType'],
      where: { firedAt: { gte: d30 } },
      _count: { _all: true },
    }),
    prisma.triggerEvent.groupBy({
      by: ['triggerType'],
      _max: { firedAt: true },
    }),
  ])

  const map = new Map<string, TriggerFiringStats>()
  const ensure = (id: string): TriggerFiringStats => {
    const existing = map.get(id)
    if (existing) return existing
    const fresh: TriggerFiringStats = {
      triggerType: id,
      fires24h: 0,
      fires7d: 0,
      fires30d: 0,
      lastFiredAt: null,
    }
    map.set(id, fresh)
    return fresh
  }

  for (const row of count24h) ensure(row.triggerType).fires24h = row._count._all
  for (const row of count7d) ensure(row.triggerType).fires7d = row._count._all
  for (const row of count30d) ensure(row.triggerType).fires30d = row._count._all
  for (const row of latest) {
    if (row._max.firedAt) ensure(row.triggerType).lastFiredAt = row._max.firedAt
  }

  return map
}
