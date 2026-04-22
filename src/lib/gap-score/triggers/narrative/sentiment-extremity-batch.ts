/**
 * T-N4 — entity sentiment extremity batch (narrative stream).
 *
 * Fires when:
 *   - ≥8 keyword-matching articles in the past 2h window for one entity
 *   - AND ≥60% of matches point in the same direction (all bullish or
 *     all bearish keywords)
 *
 * Severity scales by count × directional consistency.
 * Direction: keyword direction (+1 bullish / -1 bearish).
 *
 * No baseline required — absolute threshold. Uses keyword-lists.ts
 * matcher.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { classifyDirection } from './keyword-lists'

const TRIGGER_ID = 'T-N4'
const WINDOW_HOURS = 2
const MIN_MATCHES = 8
const MIN_CONSISTENCY = 0.6

export async function sentimentExtremityBatchTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - WINDOW_HOURS * 60 * 60 * 1000)

  const observations = await ctx.prisma.entityObservation.findMany({
    where: {
      sourceType: { in: ['gdelt_article', 'rss_article'] },
      observedAt: { gte: windowStart, lte: ctx.now },
      title: { not: null },
    },
    select: { entityId: true, title: true },
  })

  // Bucket by entity, then by direction
  const byEntity = new Map<string, { bullish: number; bearish: number; total: number }>()
  for (const o of observations) {
    if (!o.title) continue
    const cls = classifyDirection(o.title)
    if (cls.direction === null) continue
    const bucket = byEntity.get(o.entityId) ?? { bullish: 0, bearish: 0, total: 0 }
    if (cls.direction === 1) bucket.bullish++
    else bucket.bearish++
    bucket.total++
    byEntity.set(o.entityId, bucket)
  }

  // Dedupe against recent T-N4 fires
  const recentFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { entityId: true },
  })
  const alreadyFired = new Set(recentFires.map((f) => f.entityId))

  const fires: TriggerFireEvent[] = []
  for (const [entityId, b] of byEntity.entries()) {
    if (b.total < MIN_MATCHES) continue
    if (alreadyFired.has(entityId)) continue
    const bullishFrac = b.bullish / b.total
    const bearishFrac = b.bearish / b.total
    const dominantFrac = Math.max(bullishFrac, bearishFrac)
    if (dominantFrac < MIN_CONSISTENCY) continue

    const direction = bullishFrac > bearishFrac ? 1 : -1
    // Severity: count curve 8→0.5, 20+→1.0, multiplied by consistency
    const countFactor = Math.min(0.5 + ((b.total - MIN_MATCHES) / 12) * 0.5, 1.0)
    const severity = Math.min(countFactor * dominantFrac, 1.0)

    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'narrative',
      severity,
      metadata: {
        window_hours: WINDOW_HOURS,
        total_matches: b.total,
        bullish_count: b.bullish,
        bearish_count: b.bearish,
        consistency: dominantFrac,
        direction,
      },
    })
  }
  return fires
}
