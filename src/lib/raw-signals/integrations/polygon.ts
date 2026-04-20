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

import type { IntegrationResult, IntegrationRunner } from '../runner'
import { safeErrorRow, safeStringify, ERROR_VERSION } from '../error-shape'
import { prisma } from '@/lib/db'
import { fetchWithTimeout } from '@/lib/utils'

const POLYGON_BASE = 'https://api.polygon.io'
const POLYGON_TIMEOUT_MS = 8_000

interface TickerData {
  ticker: string
  entityName: string
  eod?: { open: number; high: number; low: number; close: number; volume: number; ts: number }
  snapshot?: { lastPrice: number | null; lastQuote: number | null }
  reference?: { name: string; sicDescription: string | null; marketCap: number | null; primaryExchange: string | null }
  errors: string[]
}

async function fetchEod(ticker: string, apiKey: string): Promise<TickerData['eod'] | undefined> {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`
  try {
    const res = await fetchWithTimeout(url, POLYGON_TIMEOUT_MS, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { results?: Array<{ c: number; o: number; h: number; l: number; v: number; t: number }> }
    const r = data.results?.[0]
    if (!r) return undefined
    return { open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, ts: r.t }
  } catch {
    return undefined
  }
}

async function fetchSnapshot(ticker: string, apiKey: string): Promise<TickerData['snapshot'] | undefined> {
  const url = `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`
  try {
    const res = await fetchWithTimeout(url, POLYGON_TIMEOUT_MS, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { ticker?: { lastQuote?: { p?: number; P?: number }; lastTrade?: { p?: number } } }
    if (!data.ticker) return undefined
    return {
      lastPrice: data.ticker.lastTrade?.p ?? null,
      lastQuote: data.ticker.lastQuote?.p ?? data.ticker.lastQuote?.P ?? null,
    }
  } catch {
    return undefined
  }
}

async function fetchReference(ticker: string, apiKey: string): Promise<TickerData['reference'] | undefined> {
  const url = `${POLYGON_BASE}/v3/reference/tickers/${encodeURIComponent(ticker)}`
  try {
    const res = await fetchWithTimeout(url, POLYGON_TIMEOUT_MS, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { results?: { name?: string; sic_description?: string; market_cap?: number; primary_exchange?: string } }
    const r = data.results
    if (!r) return undefined
    return {
      name: r.name ?? ticker,
      sicDescription: r.sic_description ?? null,
      marketCap: r.market_cap ?? null,
      primaryExchange: r.primary_exchange ?? null,
    }
  } catch {
    return undefined
  }
}

async function fetchTicker(t: ResolvedTicker, apiKey: string): Promise<TickerData> {
  const [eod, snapshot, reference] = await Promise.all([
    fetchEod(t.ticker, apiKey),
    fetchSnapshot(t.ticker, apiKey),
    fetchReference(t.ticker, apiKey),
  ])
  const errors: string[] = []
  if (!eod) errors.push('eod_unavailable')
  if (!snapshot) errors.push('snapshot_unavailable')
  if (!reference) errors.push('reference_unavailable')
  return { ticker: t.ticker, entityName: t.entityName, eod, snapshot, reference, errors }
}

export interface ResolvedTicker {
  ticker: string
  entityName: string
}

/**
 * Resolve cluster entity names to tickers via TickerEntityMap.
 *
 * NORMALIZATION STRATEGY: match-time, not write-time.
 *
 *   TickerEntityMap is populated with canonical provider-given names (SEC
 *   EDGAR for ~12k entities, Phase 7). Write-time normalization would
 *   lose the exact source string, which is useful for audits — so we
 *   preserve the original at write time and normalize only when querying.
 *
 *   At match time we:
 *     (a) expand the candidate set with trailing-punctuation-stripped
 *         variants so "Apple Inc." and "Apple Inc" both hit the same row
 *     (b) use Prisma's `mode: 'insensitive'` so casing is handled at the DB
 *
 *   This is O(candidates × DB roundtrip) and trivial at <30 entities/cluster.
 *
 *   ESCALATION: if Polygon-never-triggers telemetry shows significant
 *   miss-rate attributable to name variance that punctuation/case can't
 *   reach (e.g., "Apple" vs "Apple Inc" — missing suffix), migrate to a
 *   normalizedName column on TickerEntityMap at write time. Revisit Phase 11+.
 */
async function resolveTickersForCluster(entities: string[]): Promise<ResolvedTicker[]> {
  if (entities.length === 0) return []

  // Build candidate set with punctuation-stripped variants. Case is handled
  // at the DB level via Prisma mode: 'insensitive'. Common extractor noise:
  // trailing period (corp.), trailing comma, multiple spaces, leading/trailing
  // whitespace.
  const candidates = new Set<string>()
  for (const e of entities) {
    const trimmed = e.trim().replace(/\s+/g, ' ')
    if (trimmed.length === 0) continue
    candidates.add(trimmed)
    candidates.add(trimmed.replace(/[.,;:]+$/g, '').trim())
  }

  const matches = await prisma.tickerEntityMap.findMany({
    where: { entity: { name: { in: Array.from(candidates), mode: 'insensitive' } } },
    select: { ticker: true, entity: { select: { name: true } } },
    take: 25,
  })

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

  let tickers: ResolvedTicker[]
  try {
    tickers = await resolveTickersForCluster(ctx.cluster.entities)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[raw-signals/polygon] Ticker resolution failed:', message)
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'prisma_query_failed',
        rawSignalQueueId: ctx.queueId,
        // First 10 entities only — telemetry size guard; full list recoverable via StoryCluster.clusterKeywords
        clusterEntities: ctx.cluster.entities.slice(0, 10),
        message: safeStringify(err),
      },
      signalSource: 'polygon',
      captureDate: ctx.cluster.firstDetectedAt,
      haikuSummary: 'Financial signal unavailable — ticker resolution failed.',
    })
  }

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

  const tickerData = await Promise.all(tickers.map((t) => fetchTicker(t, apiKey)))

  const allEndpointsHealthy = tickerData.every((t) => t.errors.length === 0)
  const allEndpointsDead = tickerData.every((t) => t.errors.length === 3)

  let confidence: IntegrationResult['confidenceLevel']
  if (allEndpointsDead) confidence = 'unavailable'
  else if (allEndpointsHealthy) confidence = 'high'
  else confidence = 'medium'

  // TODO Task 7: Haiku divergence assessment lands here; for now, leave divergence unflagged.
  return {
    rawContent: { tickers: tickerData },
    haikuSummary:
      confidence === 'unavailable'
        ? 'Financial signal unavailable — all Polygon endpoints failed for resolved tickers.'
        : `Polygon captured ${tickerData.length} ticker${tickerData.length === 1 ? '' : 's'}; divergence assessment pending.`,
    signalSource: 'polygon',
    captureDate: ctx.cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: confidence,
  }
}
