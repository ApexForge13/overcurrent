/**
 * T-META1 — Multi-stream confluence trigger.
 *
 * Pure SQL query over the TriggerEvent table: fires when ≥2 triggers from
 * ≥2 distinct streams (narrative / psychological / ground_truth) fire on
 * the same entity within a 2-hour window.
 *
 * Does NOT count the meta stream itself (would be self-referential). Does
 * NOT fire on itself — dispatcher's enabledEnvVar check doesn't care, but
 * the query filters out T-META* rows so we don't pyramid.
 *
 * Runs every 15 min from the candidate-generator cron tick (cheap pure-SQL
 * query; no external calls).
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

const WINDOW_HOURS = 2

export async function multiStreamConfluenceTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - WINDOW_HOURS * 60 * 60 * 1000)

  // Find entities with ≥2 distinct non-meta streams firing in the window.
  const events = await ctx.prisma.triggerEvent.findMany({
    where: {
      firedAt: { gte: windowStart, lte: ctx.now },
      stream: { in: ['narrative', 'psychological', 'ground_truth'] },
    },
    select: { entityId: true, stream: true, severity: true, triggerType: true, id: true },
  })

  // Group by entity, collect distinct streams.
  const byEntity = new Map<string, { streams: Set<string>; maxSeverity: number; eventIds: string[]; triggerTypes: Set<string> }>()
  for (const ev of events) {
    const existing = byEntity.get(ev.entityId) ?? {
      streams: new Set<string>(),
      maxSeverity: 0,
      eventIds: [],
      triggerTypes: new Set<string>(),
    }
    existing.streams.add(ev.stream)
    existing.maxSeverity = Math.max(existing.maxSeverity, ev.severity)
    existing.eventIds.push(ev.id)
    existing.triggerTypes.add(ev.triggerType)
    byEntity.set(ev.entityId, existing)
  }

  // Skip entities that already have a META1 fire in the window (dedup — we
  // run every 15 min on overlapping windows, don't want to re-fire).
  const recentMetaFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      firedAt: { gte: windowStart, lte: ctx.now },
      triggerType: 'T-META1',
    },
    select: { entityId: true },
  })
  const alreadyFired = new Set(recentMetaFires.map((r) => r.entityId))

  const fires: TriggerFireEvent[] = []
  for (const [entityId, info] of byEntity.entries()) {
    if (info.streams.size < 2) continue
    if (alreadyFired.has(entityId)) continue
    fires.push({
      entityId,
      triggerType: 'T-META1',
      stream: 'meta',
      severity: 1.0, // confluence is always high severity per v2 spec
      metadata: {
        window_hours: WINDOW_HOURS,
        distinct_streams: Array.from(info.streams),
        contributing_trigger_types: Array.from(info.triggerTypes),
        contributing_event_ids: info.eventIds,
        max_contributing_severity: info.maxSeverity,
      },
    })
  }
  return fires
}
