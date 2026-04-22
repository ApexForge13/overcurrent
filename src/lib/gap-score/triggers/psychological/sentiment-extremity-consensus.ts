/**
 * T-P4 — sentiment extremity consensus (psychological stream).
 *
 * Directional keyword match on social post titles over a 2h window.
 * Fires when:
 *   - ≥30 directional posts
 *   - AND ≥75% same direction
 *
 * Severity scales by count × consistency. Direction = keyword direction.
 *
 * Same mechanics as T-N4 but applied to psych sources (reddit_post,
 * twitter_post) with tighter thresholds (addendum A1.3 T-P4).
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { classifyDirection } from '@/lib/gap-score/triggers/narrative/keyword-lists'

const TRIGGER_ID = 'T-P4'
const WINDOW_HOURS = 2
const MIN_MATCHES = 30
const MIN_CONSISTENCY = 0.75
const PSYCH_SOURCE_TYPES = ['reddit_post', 'twitter_post']

export async function sentimentExtremityConsensusTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - WINDOW_HOURS * 60 * 60 * 1000)

  const observations = await ctx.prisma.entityObservation.findMany({
    where: {
      sourceType: { in: PSYCH_SOURCE_TYPES },
      observedAt: { gte: windowStart, lte: ctx.now },
      title: { not: null },
    },
    select: { entityId: true, title: true },
  })

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
    // Severity: 30 → 0.5, 100+ → 1.0, × consistency
    const countFactor = Math.min(0.5 + ((b.total - MIN_MATCHES) / 70) * 0.5, 1.0)
    const severity = Math.min(countFactor * dominantFrac, 1.0)

    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'psychological',
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
