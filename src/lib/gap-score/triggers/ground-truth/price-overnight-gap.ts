/**
 * T-GT6 — overnight price gap.
 *
 * For each featured-set entity, fetches the most-recent daily bar
 * (today's bar, pulled shortly after market open) and computes
 * (open - prevClose) / prevClose. The prevClose comes from the prior
 * daily bar.
 *
 * Fires when |gap| exceeds the per-category threshold AND realized-vol
 * baseline is mature. Severity = |gap| / realized_vol, cap 1.0.
 *
 * Scheduled daily at market open (14:00 UTC = 09:00 ET pre-market /
 * 09:30 open window). Fires once per entity per day via dedup on fired
 * today.
 *
 * For commodity futures + yields: Polygon stock feed doesn't carry them,
 * so trigger skips (ticker map returns null).
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { fetchPreviousDayBar, fetchDailyBars } from '@/lib/raw-signals/clients/polygon-client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'
import {
  getOvernightThreshold,
  resolvePriceCategory,
} from './price-thresholds'
import { mapIdentifierToPolygonTicker } from './price-baseline-worker'

const TRIGGER_ID = 'T-GT6'
const METRIC_NAME = 'realized_vol_30d'
const WINDOW_DAYS = 30

export async function priceOvernightGapTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    await writeMissingKeyHeartbeat(ctx.prisma, 'polygon', 'POLYGON_API_KEY')
    return []
  }

  const entities = await ctx.prisma.trackedEntity.findMany({
    where: {
      isFeatured: true,
      active: true,
      category: { in: ['equity', 'etf', 'crypto'] },
    },
    select: { id: true, identifier: true, category: true },
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

    // Fetch prev day to get its close (= yesterday's close)
    const prev = await fetchPreviousDayBar(ticker, apiKey)
    if (!prev.ok) continue

    // Fetch today's bar to get open
    const todayIso = ctx.now.toISOString().split('T')[0]
    const today = await fetchDailyBars(ticker, todayIso, todayIso, apiKey)
    if (!today.ok || today.value.length === 0) continue

    const prevClose = prev.value.close
    const todayOpen = today.value[0].open
    if (!prevClose || prevClose <= 0 || !todayOpen) continue

    const gapPct = (todayOpen - prevClose) / prevClose
    const threshold = getOvernightThreshold(entity.category, ctx.thresholds)
    if (Math.abs(gapPct) < threshold) continue

    const dailyVol = baseline.stddev
    const severity = dailyVol > 0 ? Math.min(Math.abs(gapPct) / dailyVol, 1.0) : Math.min(Math.abs(gapPct) * 10, 1.0)
    const direction = gapPct > 0 ? 1 : -1

    fires.push({
      entityId: entity.id,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity,
      metadata: {
        identifier: entity.identifier,
        category: resolvePriceCategory(entity.category),
        prev_close: prevClose,
        today_open: todayOpen,
        gap_pct: gapPct,
        threshold_pct: threshold,
        realized_vol_30d: dailyVol,
        direction,
      },
    })
  }

  return fires
}
