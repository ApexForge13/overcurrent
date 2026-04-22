/**
 * T-N3 — wire-quality headline event (narrative stream).
 *
 * Scans recent EntityObservation titles for wire-pattern matches
 * (earnings beat/miss, guidance rev, M&A, regulatory, exec change,
 * bankruptcy, material contract). Fires severity 1.0 per match;
 * direction from the pattern (Item 4.02 analogue here is bankruptcy
 * → -1, FDA approval → +1; ambiguous patterns direction=0 → LLM
 * sentiment at scoring layer).
 *
 * Dedupes: one fire per (entity, observation) — replays on overlapping
 * windows don't re-fire the same observation.
 *
 * No baseline required — pattern-based.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { matchWirePatterns } from './wire-patterns'

const TRIGGER_ID = 'T-N3'
const SCAN_WINDOW_MINUTES = 60 // one-hour lookback; scheduler runs every 5 min
const SEVERITY = 1.0

export async function wireHeadlineTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - SCAN_WINDOW_MINUTES * 60 * 1000)

  const observations = await ctx.prisma.entityObservation.findMany({
    where: {
      sourceType: { in: ['gdelt_article', 'rss_article'] },
      observedAt: { gte: windowStart, lte: ctx.now },
      title: { not: null },
    },
    select: { id: true, entityId: true, title: true, outlet: true, sourceUrl: true, observedAt: true },
  })

  // Dedupe against previously-fired T-N3 for same (entity, sourceUrl)
  const recentFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { metadata: true },
  })
  const firedKeys = new Set(
    recentFires.map((f) => {
      const md = f.metadata as Record<string, unknown> | null
      return `${md?.entityId ?? ''}|${md?.source_url ?? ''}`
    }),
  )

  const fires: TriggerFireEvent[] = []
  for (const obs of observations) {
    if (!obs.title) continue
    const matches = matchWirePatterns(obs.title)
    if (matches.length === 0) continue

    const key = `${obs.entityId}|${obs.sourceUrl ?? ''}`
    if (firedKeys.has(key)) continue

    // Pick dominant pattern: prefer directional over ambiguous
    const sorted = [...matches].sort((a, b) => {
      const aScore = Math.abs(a.direction)
      const bScore = Math.abs(b.direction)
      return bScore - aScore
    })
    const dominant = sorted[0]

    fires.push({
      entityId: obs.entityId,
      triggerType: TRIGGER_ID,
      stream: 'narrative',
      severity: SEVERITY,
      metadata: {
        entityId: obs.entityId,
        source_url: obs.sourceUrl,
        title: obs.title,
        outlet: obs.outlet,
        observed_at: obs.observedAt.toISOString(),
        dominant_pattern: dominant.patternId,
        dominant_category: dominant.category,
        direction: dominant.direction,
        all_matches: matches.map((m) => m.patternId),
      },
    })
  }
  return fires
}
