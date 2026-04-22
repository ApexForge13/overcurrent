/**
 * Price baseline recomputation.
 *
 * For each active equity / ETF / commodity / crypto entity, fetches 30
 * calendar days of daily bars from Polygon and computes realized
 * volatility (stddev of daily log returns, annualized or as-is — we use
 * as-is daily since T-GT5/6 scale moves by daily vol).
 *
 * Stores in EntityBaseline with metricName='realized_vol_30d',
 * windowDays=30, minSampleSize=25. Flips isMature when ≥25 bars are
 * available (accounts for holidays + trading-day gaps in a 30-cal-day
 * window).
 *
 * Scheduled nightly via the gap-score-baseline-compute queue (low
 * cadence — volatility changes slowly).
 *
 * Graceful: missing POLYGON_API_KEY → writes missing-key heartbeat and
 * returns. Per-ticker fetch errors don't kill the batch.
 */

import type { PrismaClient } from '@prisma/client'
import { fetchDailyBars } from '@/lib/raw-signals/clients/polygon-client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'

const METRIC_NAME = 'realized_vol_30d'
const WINDOW_DAYS = 30
const MIN_SAMPLE_SIZE = 25
const PRICE_ELIGIBLE_CATEGORIES = ['equity', 'etf', 'commodity', 'crypto', 'yield']

export interface PriceBaselineResult {
  entitiesEvaluated: number
  baselinesUpserted: number
  maturityFlipped: number
  keyMissing: boolean
  fetchErrors: number
}

/**
 * Compute daily log-return stddev over a bar series. Returns 0 when
 * insufficient data.
 */
export function computeRealizedVolatility(bars: Array<{ close: number }>): {
  stddev: number
  mean: number
  sampleCount: number
} {
  if (bars.length < 2) return { stddev: 0, mean: 0, sampleCount: 0 }
  const returns: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close
    const curr = bars[i].close
    if (prev <= 0 || curr <= 0) continue
    returns.push(Math.log(curr / prev))
  }
  if (returns.length === 0) return { stddev: 0, mean: 0, sampleCount: 0 }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length
  return { stddev: Math.sqrt(variance), mean, sampleCount: returns.length }
}

/**
 * Recompute realized-vol baselines for all price-eligible entities. Pulls
 * 30 calendar days of bars per ticker. Called nightly.
 */
export async function recomputePriceBaselines(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PriceBaselineResult> {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    await writeMissingKeyHeartbeat(prisma, 'polygon', 'POLYGON_API_KEY')
    return {
      entitiesEvaluated: 0,
      baselinesUpserted: 0,
      maturityFlipped: 0,
      keyMissing: true,
      fetchErrors: 0,
    }
  }

  const entities = await prisma.trackedEntity.findMany({
    where: { active: true, category: { in: PRICE_ELIGIBLE_CATEGORIES } },
    select: { id: true, identifier: true, category: true },
  })

  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const startIso = start.toISOString().split('T')[0]
  const endIso = now.toISOString().split('T')[0]

  let baselinesUpserted = 0
  let maturityFlipped = 0
  let fetchErrors = 0

  for (const entity of entities) {
    const tickerForPolygon = mapIdentifierToPolygonTicker(entity.identifier, entity.category)
    if (!tickerForPolygon) continue

    const outcome = await fetchDailyBars(tickerForPolygon, startIso, endIso, apiKey)
    if (!outcome.ok) {
      fetchErrors++
      continue
    }
    const stats = computeRealizedVolatility(outcome.value)
    const existing = await prisma.entityBaseline.findUnique({
      where: {
        entityId_metricName_windowDays: {
          entityId: entity.id,
          metricName: METRIC_NAME,
          windowDays: WINDOW_DAYS,
        },
      },
      select: { isMature: true },
    })
    const wasMature = existing?.isMature ?? false
    const isMatureNow = stats.sampleCount >= MIN_SAMPLE_SIZE

    await prisma.entityBaseline.upsert({
      where: {
        entityId_metricName_windowDays: {
          entityId: entity.id,
          metricName: METRIC_NAME,
          windowDays: WINDOW_DAYS,
        },
      },
      create: {
        entityId: entity.id,
        metricName: METRIC_NAME,
        windowDays: WINDOW_DAYS,
        mean: stats.mean,
        stddev: stats.stddev,
        sampleCount: stats.sampleCount,
        minSampleSize: MIN_SAMPLE_SIZE,
        isMature: isMatureNow,
      },
      update: {
        mean: stats.mean,
        stddev: stats.stddev,
        sampleCount: stats.sampleCount,
        isMature: isMatureNow,
      },
    })
    baselinesUpserted++
    if (!wasMature && isMatureNow) maturityFlipped++
  }

  return {
    entitiesEvaluated: entities.length,
    baselinesUpserted,
    maturityFlipped,
    keyMissing: false,
    fetchErrors,
  }
}

/**
 * Map our identifier scheme to Polygon's ticker convention:
 *   Equity/ETF    — 1:1 (AAPL, TSLA, XLE)
 *   Commodity     — X:CL=F → null (commodities don't trade on Polygon;
 *                    skip — picked up via EIA/USDA releases instead)
 *   Crypto        — X:BTCUSD (Polygon crypto prefix)
 *   Yield         — skip (bonds not in Polygon stock feed)
 * Returns null for identifiers we can't map; caller skips the entity.
 */
export function mapIdentifierToPolygonTicker(
  identifier: string,
  category: string,
): string | null {
  if (category === 'equity' || category === 'etf') {
    // Strip any dot-class for Polygon matching: BRK.B → BRK.B works, AAPL is clean.
    return identifier
  }
  if (category === 'crypto') {
    // Only handle BTC/ETH tickers with Polygon prefix; others return null.
    const upper = identifier.toUpperCase()
    if (/^[A-Z]{3,4}$/.test(upper)) return `X:${upper}USD`
    return null
  }
  // Commodity futures + yields not supported via Polygon stock feed.
  return null
}
