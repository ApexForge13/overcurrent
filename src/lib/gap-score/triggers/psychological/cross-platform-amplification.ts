/**
 * T-P3 — cross-platform amplification (psychological stream meta).
 *
 * Pure SQL over TriggerEvent table: fires when T-P1 fires on the same
 * entity on ≥2 distinct platforms within a 2h window. Platform is
 * derived from the T-P1 fire's sourceType (via looking at the entity's
 * EntityObservation stream — we look at which sources had rollups that
 * contributed to the T-P1 fire).
 *
 * Simpler proxy for 1c.2b.1: read EntityObservation rows in the same
 * window, count DISTINCT sourceType among recent observations on the
 * entity. If T-P1 fired AND ≥2 distinct platforms had observations in
 * the window, T-P3 fires.
 *
 * Severity: 0.6 for 2 platforms, 1.0 for 3+.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

const TRIGGER_ID = 'T-P3'
const WINDOW_HOURS = 2
const PSYCH_SOURCE_TYPES = ['reddit_post', 'twitter_post']

export async function crossPlatformAmplificationTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - WINDOW_HOURS * 60 * 60 * 1000)

  // Entities that had T-P1 fire in the window
  const p1Fires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: 'T-P1',
      firedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { entityId: true },
    distinct: ['entityId'],
  })
  if (p1Fires.length === 0) return []

  const entityIds = p1Fires.map((e) => e.entityId)

  // For each candidate entity, fetch observation platforms in window
  const obs = await ctx.prisma.entityObservation.findMany({
    where: {
      entityId: { in: entityIds },
      sourceType: { in: PSYCH_SOURCE_TYPES },
      observedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { entityId: true, sourceType: true },
  })

  const platformsByEntity = new Map<string, Set<string>>()
  for (const o of obs) {
    const set = platformsByEntity.get(o.entityId) ?? new Set<string>()
    set.add(o.sourceType)
    platformsByEntity.set(o.entityId, set)
  }

  // Dedupe against recent T-P3 fires
  const alreadyFired = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { entityId: true },
  })
  const alreadyFiredSet = new Set(alreadyFired.map((f) => f.entityId))

  const fires: TriggerFireEvent[] = []
  for (const [entityId, platforms] of platformsByEntity.entries()) {
    if (platforms.size < 2) continue
    if (alreadyFiredSet.has(entityId)) continue

    const severity = platforms.size >= 3 ? 1.0 : 0.6
    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'psychological',
      severity,
      metadata: {
        window_hours: WINDOW_HOURS,
        distinct_platforms: platforms.size,
        platforms: Array.from(platforms),
        direction: 0,
      },
    })
  }
  return fires
}
