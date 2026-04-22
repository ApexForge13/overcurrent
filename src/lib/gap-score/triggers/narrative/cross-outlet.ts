/**
 * T-N2 — cross-outlet amplification (narrative stream).
 *
 * Fires when ≥5 distinct outlets mention the same entity within a
 * 30-minute rolling window. Severity 0.5 at 5 outlets, scales linearly
 * to 1.0 at 10+.
 *
 * Phase 1 addendum A1.2 T-N2 calls for "AND NOT during a known
 * scheduled event (earnings, Fed day)". That guard is deferred to
 * 1c.2b.2 when we have an earnings + FOMC calendar to check against.
 * Documented gap; acceptable false-positive risk in the interim.
 *
 * No baseline required — absolute threshold.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

const TRIGGER_ID = 'T-N2'
const WINDOW_MINUTES = 30
const MIN_DISTINCT_OUTLETS = 5
const MAX_DISTINCT_OUTLETS_FOR_SEVERITY = 10

export async function crossOutletTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - WINDOW_MINUTES * 60 * 1000)

  const observations = await ctx.prisma.entityObservation.findMany({
    where: {
      sourceType: { in: ['gdelt_article', 'rss_article'] },
      observedAt: { gte: windowStart, lte: ctx.now },
      outlet: { not: null },
    },
    select: { entityId: true, outlet: true },
  })

  const outletsByEntity = new Map<string, Set<string>>()
  for (const o of observations) {
    if (!o.outlet) continue
    const set = outletsByEntity.get(o.entityId) ?? new Set<string>()
    set.add(o.outlet)
    outletsByEntity.set(o.entityId, set)
  }

  // Dedupe against already-fired T-N2 events for same entity in window
  const recentFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { entityId: true },
  })
  const alreadyFired = new Set(recentFires.map((f) => f.entityId))

  const fires: TriggerFireEvent[] = []
  for (const [entityId, outlets] of outletsByEntity.entries()) {
    if (outlets.size < MIN_DISTINCT_OUTLETS) continue
    if (alreadyFired.has(entityId)) continue

    // Severity 0.5 at 5 → 1.0 at 10+ (linear)
    const above = outlets.size - MIN_DISTINCT_OUTLETS
    const range = MAX_DISTINCT_OUTLETS_FOR_SEVERITY - MIN_DISTINCT_OUTLETS
    const severity = Math.min(0.5 + (above / range) * 0.5, 1.0)

    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'narrative',
      severity,
      metadata: {
        distinct_outlets: outlets.size,
        outlets: Array.from(outlets).slice(0, 10),
        window_minutes: WINDOW_MINUTES,
        // TODO(1c.2b.2): scheduled-event quiet-period guard not applied
        // in 1c.2b.1 — earnings + FOMC calendar required.
        direction: 0,
      },
    })
  }
  return fires
}
