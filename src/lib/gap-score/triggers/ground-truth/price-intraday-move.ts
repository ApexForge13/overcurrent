/**
 * T-GT5 — intraday price move.
 *
 * For each featured-set entity eligible for Polygon pricing, fetches the
 * real-time snapshot and computes (lastPrice - prevClose) / prevClose.
 * Fires when |move| exceeds the per-category threshold AND realized-vol
 * baseline is mature.
 *
 * Severity = |move_pct| / (realized_vol * sqrt(1)) capped at 1.0 — a 3%
 * move on a 1%-daily-vol stock is severity 3.0→1.0; a 3% move on a 5%-vol
 * stock is severity 0.6.
 *
 * Direction: +1 positive, -1 negative.
 *
 * Dedup: per (entityId, trading day) via TriggerEvent timestamp check.
 * Scheduler runs every 15 min; intraday fires once per entity per day.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { fetchSnapshot } from '@/lib/raw-signals/clients/polygon-client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'
import {
  getIntradayThreshold,
  resolvePriceCategory,
} from './price-thresholds'
import { mapIdentifierToPolygonTicker } from './price-baseline-worker'

const TRIGGER_ID = 'T-GT5'
const METRIC_NAME = 'realized_vol_30d'
const WINDOW_DAYS = 30

export async function priceIntradayMoveTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    await writeMissingKeyHeartbeat(ctx.prisma, 'polygon', 'POLYGON_API_KEY')
    return []
  }

  // Featured set only for 1c.2b.2 — scale-up per manifest A2 decision
  // (options flow scope, which shares this tier)
  const entities = await ctx.prisma.trackedEntity.findMany({
    where: {
      isFeatured: true,
      active: true,
      category: { in: ['equity', 'etf', 'crypto'] },
    },
    select: { id: true, identifier: true, category: true, subcategory: true },
  })
  if (entities.length === 0) return []

  const baselines = await ctx.prisma.entityBaseline.findMany({
    where: {
      entityId: { in: entities.map((e) => e.id) },
      metricName: METRIC_NAME,
      windowDays: WINDOW_DAYS,
      isMature: true,
    },
    select: { entityId: true, stddev: true },
  })
  const baselineByEntity = new Map(baselines.map((b) => [b.entityId, b]))

  // Fetch fires already emitted today to dedup
  const todayStart = new Date(ctx.now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const todaysFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: todayStart, lte: ctx.now },
    },
    select: { entityId: true },
  })
  const alreadyFired = new Set(todaysFires.map((f) => f.entityId))

  const fires: TriggerFireEvent[] = []

  for (const entity of entities) {
    if (alreadyFired.has(entity.id)) continue
    const baseline = baselineByEntity.get(entity.id)
    if (!baseline) continue

    const ticker = mapIdentifierToPolygonTicker(entity.identifier, entity.category)
    if (!ticker) continue

    const outcome = await fetchSnapshot(ticker, apiKey)
    if (!outcome.ok) continue

    const snap = outcome.value
    if (snap.lastPrice === null || snap.prevClose === null || snap.prevClose <= 0) continue
    const movePct = (snap.lastPrice - snap.prevClose) / snap.prevClose

    const threshold = getIntradayThreshold(entity.category, ctx.thresholds)
    if (Math.abs(movePct) < threshold) continue

    const dailyVol = baseline.stddev
    const severity = dailyVol > 0 ? Math.min(Math.abs(movePct) / dailyVol, 1.0) : Math.min(Math.abs(movePct) * 10, 1.0)
    const direction = movePct > 0 ? 1 : -1

    fires.push({
      entityId: entity.id,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity,
      metadata: {
        identifier: entity.identifier,
        category: resolvePriceCategory(entity.category),
        last_price: snap.lastPrice,
        prev_close: snap.prevClose,
        move_pct: movePct,
        threshold_pct: threshold,
        realized_vol_30d: dailyVol,
        direction,
      },
    })
  }

  return fires
}
