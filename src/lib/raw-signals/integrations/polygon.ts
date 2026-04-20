/**
 * Polygon.io integration — Stocks Starter tier (EOD OHLCV + 15-min delayed
 * snapshots + tickers/financials reference).
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   POLYGON_API_KEY (optional — absence is the dominant degradation path
 *                    on day one; integration ships before the key does)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Flat $29/mo unlimited calls. Per-call cost in CostLog is $0.
 *
 * ── Target behavior (Tasks 4-7) ───────────────────────────────────────
 * Always-on per cluster. Resolves cluster.entities through TickerEntityMap;
 * for each resolved ticker, pulls EOD bar + delayed snapshot + reference
 * data, runs Haiku assessment for >2σ price move within 72h of
 * cluster.firstDetectedAt.
 *
 * Writes ONE RawSignalLayer row per cluster (multi-ticker payload in
 * rawContent JSON). Per-entity fan-out happens downstream via
 * onRawSignalWritten → EntitySignalIndex.
 *
 * ── Graceful degradation ──────────────────────────────────────────────
 * Always returns a non-null result. Never throws. Failure modes:
 *   - POLYGON_API_KEY absent → confidenceLevel='unavailable'
 *   - Cluster has no ticker-resolvable entities → 'unavailable'
 *   - Endpoint timeout / HTTP error → partial data with degraded confidence
 *   - Ticker not in Polygon universe → ticker-level error captured in row
 *
 * ── Phase 8 scaffolding stages ────────────────────────────────────────
 * Task 3 (this file, first pass): key-absent unavailable path only.
 * Subsequent tasks (4-7) add ticker resolution, endpoint fetchers, and
 * Haiku divergence assessment.
 */

import type { IntegrationRunner } from '../runner'
import { prisma } from '@/lib/db'

interface ResolvedTicker {
  ticker: string
  entityName: string
}

async function resolveTickersForCluster(entities: string[]): Promise<ResolvedTicker[]> {
  if (entities.length === 0) return []
  const matches = await prisma.tickerEntityMap.findMany({
    where: { entity: { name: { in: entities } } },
    select: { ticker: true, entity: { select: { name: true } } },
    take: 25,
  })
  // Dedup by ticker (in case one ticker maps through multiple entity rows)
  const seen = new Set<string>()
  const out: ResolvedTicker[] = []
  for (const m of matches) {
    if (seen.has(m.ticker)) continue
    seen.add(m.ticker)
    out.push({ ticker: m.ticker, entityName: m.entity.name })
  }
  return out
}

export const polygonRunner: IntegrationRunner = async (ctx) => {
  const apiKey = process.env.POLYGON_API_KEY

  if (!apiKey) {
    return {
      rawContent: {
        reason: 'POLYGON_API_KEY absent in this environment',
        clusterEntities: ctx.cluster.entities.slice(0, 10),
      },
      haikuSummary:
        'Financial signal unavailable — Polygon not yet provisioned for this environment.',
      signalSource: 'polygon',
      captureDate: ctx.cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'unavailable',
    }
  }

  const tickers = await resolveTickersForCluster(ctx.cluster.entities)
  if (tickers.length === 0) {
    return {
      rawContent: {
        resolvedTickers: [],
        clusterEntities: ctx.cluster.entities.slice(0, 10),
      },
      haikuSummary:
        'Financial signal unavailable — no equity-tradable entities resolved for this cluster.',
      signalSource: 'polygon',
      captureDate: ctx.cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'unavailable',
    }
  }

  // TODO Task 5+: per-ticker endpoint fetches + Haiku assessment.
  return {
    rawContent: { note: 'Per-ticker fetch pending', resolvedTickers: tickers },
    haikuSummary: 'Financial signal unavailable — fetch implementation incomplete.',
    signalSource: 'polygon',
    captureDate: ctx.cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: 'unavailable',
  }
}
