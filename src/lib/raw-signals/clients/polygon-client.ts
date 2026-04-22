/**
 * Polygon.io shared HTTP + parse client.
 *
 * Extracted from src/lib/raw-signals/integrations/polygon.ts so trigger
 * code (T-GT5/6/12) can share the primitives without inheriting
 * cluster-context logic.
 *
 * Target tier: Polygon Developer ($249/mo) + options real-time add-on.
 * Developer provides real-time stocks + historical aggs; the options
 * add-on unlocks the OPRA feed used by T-GT12 unusual options flow.
 *
 * ── Endpoints used ─────────────────────────────────────────────────────
 *   /v2/aggs/ticker/{ticker}/prev                — previous day bar (T-GT6 gap)
 *   /v2/aggs/ticker/{ticker}/range/1/day/{start}/{end} — daily bars for vol baseline
 *   /v2/snapshot/locale/us/markets/stocks/tickers/{ticker} — real-time snapshot (T-GT5)
 *   /v3/snapshot/options/{underlying}             — options chain + unusual activity (T-GT12)
 *
 * ── Error routing ──────────────────────────────────────────────────────
 *   401/403 → auth_failed
 *   429     → rate_limited (+ retryAfterSec)
 *   4xx     → client_error (+ statusCode)
 *   5xx     → server_error (+ statusCode)
 *   Abort   → timeout
 *   Other   → unknown (+ message)
 *
 * ── Env gating ─────────────────────────────────────────────────────────
 * POLYGON_API_KEY presence checked at each call site; clients that need
 * to short-circuit on missing key should check process.env.POLYGON_API_KEY
 * first and emit a missing-key heartbeat via writeMissingKeyHeartbeat.
 */

import { fetchWithTimeout } from '@/lib/utils'
import { safeStringify } from '../error-shape'

const BASE_URL = 'https://api.polygon.io'
const TIMEOUT_MS = 10_000

export type PolygonFetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; errorType: 'auth_failed' }
  | { ok: false; errorType: 'rate_limited'; retryAfterSec?: number }
  | { ok: false; errorType: 'client_error'; statusCode: number }
  | { ok: false; errorType: 'server_error'; statusCode: number }
  | { ok: false; errorType: 'timeout' }
  | { ok: false; errorType: 'parse_error'; message: string }
  | { ok: false; errorType: 'unknown'; message: string }

export interface PolygonDailyBar {
  open: number
  high: number
  low: number
  close: number
  volume: number
  ts: number // epoch ms
}

export interface PolygonSnapshot {
  ticker: string
  lastPrice: number | null
  prevClose: number | null
  dayOpen: number | null
  todaysChangePerc: number | null
  updated: number | null // epoch ns or ms (Polygon returns nanos)
}

export interface PolygonOptionContract {
  contract: string // OCC symbol
  underlying: string
  expiration: string // ISO date
  strike: number
  type: 'call' | 'put'
  dayVolume: number
  openInterest: number
  impliedVolatility: number | null
  lastPrice: number | null
}

function parseRetryAfter(headers: { get: (name: string) => string | null }): number | undefined {
  const raw = headers.get('retry-after') ?? headers.get('Retry-After')
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true
    if (/timeout/i.test(err.message)) return true
  }
  return false
}

async function requestJson(
  url: string,
  apiKey: string,
): Promise<PolygonFetchOutcome<unknown>> {
  let res: Response
  try {
    res = await fetchWithTimeout(url, TIMEOUT_MS, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, errorType: 'timeout' }
    return { ok: false, errorType: 'unknown', message: safeStringify(err) }
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return { ok: false, errorType: 'auth_failed' }
    if (res.status === 429) {
      return { ok: false, errorType: 'rate_limited', retryAfterSec: parseRetryAfter(res.headers) }
    }
    if (res.status >= 500) {
      return { ok: false, errorType: 'server_error', statusCode: res.status }
    }
    return { ok: false, errorType: 'client_error', statusCode: res.status }
  }
  try {
    return { ok: true, value: await res.json() }
  } catch (err) {
    return { ok: false, errorType: 'parse_error', message: safeStringify(err) }
  }
}

/**
 * Previous day bar for a ticker — {open, high, low, close, volume, ts}.
 * Used by T-GT6 (overnight gap): compare tomorrow's open to today's close.
 */
export async function fetchPreviousDayBar(
  ticker: string,
  apiKey: string,
): Promise<PolygonFetchOutcome<PolygonDailyBar>> {
  const url = `${BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`
  const result = await requestJson(url, apiKey)
  if (!result.ok) return result
  const data = result.value as { results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }> }
  const r = data.results?.[0]
  if (!r) return { ok: false, errorType: 'parse_error', message: 'no results in response' }
  return { ok: true, value: { open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, ts: r.t } }
}

/**
 * Daily bars for a date range — used by the 30-day realized volatility
 * baseline worker.
 */
export async function fetchDailyBars(
  ticker: string,
  startIsoDate: string,
  endIsoDate: string,
  apiKey: string,
): Promise<PolygonFetchOutcome<PolygonDailyBar[]>> {
  const url = `${BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${startIsoDate}/${endIsoDate}`
  const result = await requestJson(url, apiKey)
  if (!result.ok) return result
  const data = result.value as { results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }> }
  const bars = Array.isArray(data.results)
    ? data.results.map((r) => ({ open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, ts: r.t }))
    : []
  return { ok: true, value: bars }
}

/**
 * Real-time snapshot — used by T-GT5 intraday move. Returns current
 * lastPrice + prevClose so the caller can compute intraday % change.
 */
export async function fetchSnapshot(
  ticker: string,
  apiKey: string,
): Promise<PolygonFetchOutcome<PolygonSnapshot>> {
  const url = `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`
  const result = await requestJson(url, apiKey)
  if (!result.ok) return result
  const data = result.value as {
    ticker?: {
      ticker?: string
      lastTrade?: { p?: number }
      prevDay?: { c?: number }
      day?: { o?: number }
      todaysChangePerc?: number
      updated?: number
    }
  }
  const t = data.ticker
  if (!t) return { ok: false, errorType: 'parse_error', message: 'no ticker in response' }
  return {
    ok: true,
    value: {
      ticker: t.ticker ?? ticker,
      lastPrice: t.lastTrade?.p ?? null,
      prevClose: t.prevDay?.c ?? null,
      dayOpen: t.day?.o ?? null,
      todaysChangePerc: t.todaysChangePerc ?? null,
      updated: t.updated ?? null,
    },
  }
}

/**
 * Options-chain snapshot for an underlying — used by T-GT12 unusual flow.
 * Returns the list of contracts with volume + open interest. Caller filters
 * for "unusual" ratio (volume > N × open interest).
 *
 * Requires Polygon Developer tier + options real-time add-on; absent the
 * options add-on, endpoint returns 403 which we route to auth_failed.
 */
export async function fetchOptionsChain(
  underlying: string,
  apiKey: string,
): Promise<PolygonFetchOutcome<PolygonOptionContract[]>> {
  const url = `${BASE_URL}/v3/snapshot/options/${encodeURIComponent(underlying)}?limit=250`
  const result = await requestJson(url, apiKey)
  if (!result.ok) return result
  const data = result.value as {
    results?: Array<{
      details?: { contract_type?: string; exercise_style?: string; expiration_date?: string; strike_price?: number; ticker?: string }
      day?: { volume?: number; close?: number }
      open_interest?: number
      implied_volatility?: number
      underlying_asset?: { ticker?: string }
    }>
  }
  if (!Array.isArray(data.results)) {
    return { ok: false, errorType: 'parse_error', message: 'no results array' }
  }
  const contracts: PolygonOptionContract[] = data.results
    .map((r) => {
      const type: 'call' | 'put' | null =
        r.details?.contract_type === 'call'
          ? 'call'
          : r.details?.contract_type === 'put'
            ? 'put'
            : null
      if (!type) return null
      return {
        contract: r.details?.ticker ?? '',
        underlying,
        expiration: r.details?.expiration_date ?? '',
        strike: r.details?.strike_price ?? 0,
        type,
        dayVolume: r.day?.volume ?? 0,
        openInterest: r.open_interest ?? 0,
        impliedVolatility: r.implied_volatility ?? null,
        lastPrice: r.day?.close ?? null,
      }
    })
    .filter((c): c is PolygonOptionContract => c !== null && c.contract !== '')
  return { ok: true, value: contracts }
}
