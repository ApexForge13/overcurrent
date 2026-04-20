/**
 * FRED — St. Louis Fed macroeconomic data.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   FRED_API_KEY (required, free registration at
 *   https://fred.stlouisfed.org/docs/api/api_key.html)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. Unlimited calls. Per-call cost in CostLog is $0.
 *
 * ── Normalization strategy ────────────────────────────────────────────
 * FRED is a keyword/category-driven adapter. There is no per-entity
 * resolution step — series IDs are selected at runtime based on
 * cluster.signalCategory, not cluster.entities. The default macro set
 * applies to every cluster; environmental_event and trade_dispute add
 * category-specific series on top. No TickerEntityMap lookup, no CIK
 * resolution, no match-time name variance to worry about.
 *
 * ── Error routing (canonical error-shape) ─────────────────────────────
 * Every failure path writes a RawSignalLayer row via safeErrorRow with
 * confidenceLevel='unavailable' and a RawSignalError discriminated-union
 * literal:
 *
 *   FRED_API_KEY missing     → auth_failed          (provider: 'fred')
 *   HTTP 429                 → rate_limited         (+ retryAfterSec)
 *   HTTP 4xx/5xx (not 429)   → external_api_error   (+ statusCode)
 *   AbortError / /timeout/i  → timeout              (+ timeoutMs)
 *   JSON shape mismatch      → parse_error
 *   Uncaught                 → unknown
 *
 * rawSignalQueueId is carried on every variant (Phase 11 dossier FK).
 *
 * ── Query-string API key (vs. Polygon's Authorization header) ─────────
 * FRED's public API only supports the `api_key` query-string parameter.
 * There is no header-based auth. We accept the minor leak-to-logs risk
 * here because FRED documents it as the only supported pattern and the
 * key is free/rotatable (no billing tie-in). Polygon remains header-based.
 */

import type { IntegrationResult, IntegrationRunner } from '../runner'
import { safeErrorRow, safeStringify, ERROR_VERSION } from '../error-shape'
import { fetchWithTimeout } from '@/lib/utils'

const TIMEOUT_MS = 15_000
const API_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const OBSERVATIONS_PER_SERIES = 30
const LOOKBACK_DAYS = 90
const DIVERGENCE_Z_THRESHOLD = 2.0
const TRAILING_WINDOW = 12

// Macro series that apply to every cluster regardless of signalCategory.
const DEFAULT_SERIES = [
  'FEDFUNDS',   // Fed funds rate
  'CPIAUCSL',   // CPI (All Urban Consumers)
  'GDP',        // US GDP
  'DCOILWTICO', // WTI crude spot
  'DGS10',      // 10-year Treasury constant maturity
  'UNRATE',     // Unemployment rate (civilian)
] as const

// Category-specific additions layered on top of DEFAULT_SERIES.
// Note: DCOILWTICO appears in both DEFAULT_SERIES and ENV_EXTRA; we
// deduplicate at assembly time.
const ENV_EXTRA = ['DCOILWTICO', 'DHHNGSP'] as const       // environmental_event (oil + natural gas)
const TRADE_EXTRA = ['IR', 'IX'] as const                  // trade_dispute (imports, exports)

function seriesForCategory(category: string | null): string[] {
  const set = new Set<string>(DEFAULT_SERIES)
  if (category === 'environmental_event') {
    for (const s of ENV_EXTRA) set.add(s)
  } else if (category === 'trade_dispute') {
    for (const s of TRADE_EXTRA) set.add(s)
  }
  return Array.from(set)
}

interface SeriesResult {
  seriesId: string
  observations: Array<{ date: string; value: number | null }>
  latest: number | null
  /**
   * 90-day lookback from cluster.firstDetectedAt; rename to lookbackPctChange
   * intentional — this field is NOT year-over-year. To get true YoY, widen
   * LOOKBACK_DAYS and select the observation nearest T-365.
   */
  lookbackPctChange: number | null
  /**
   * Trailing 12 observations (~1 year monthly series / ~2.5 trading weeks
   * daily series). Observation-count based, not calendar-time based —
   * FRED mixes monthly and daily series in the default set.
   */
  trailingSigma12Obs: number | null
  trailingMean12Obs: number | null
  zScore: number | null
}

type SeriesOutcome =
  | { ok: true; value: SeriesResult }
  | { ok: false; errorType: 'rate_limited'; retryAfterSec?: number }
  | { ok: false; errorType: 'external_api_error'; statusCode: number }
  | { ok: false; errorType: 'timeout' }
  | { ok: false; errorType: 'parse_error'; message: string }
  | { ok: false; errorType: 'unknown'; message: string }

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

/**
 * Compute stats over a series' observations.
 *   - latest: first non-null in the desc-sorted list (most recent)
 *   - lookbackPctChange: percent change from the oldest observation (~90
 *     days ago given the LOOKBACK_DAYS window). Explicitly NOT year-over-
 *     year — named after the actual window.
 *   - trailingMean12Obs / trailingSigma12Obs: mean and population stddev
 *     over the trailing TRAILING_WINDOW observations (indices 1..12 in
 *     the desc-sorted list, i.e. the 12 observations immediately before
 *     `latest`)
 *   - zScore: (latest - trailingMean12Obs) / trailingSigma12Obs, guarded for /0
 */
function computeStats(
  observations: Array<{ date: string; value: number | null }>,
): Pick<
  SeriesResult,
  'latest' | 'lookbackPctChange' | 'trailingSigma12Obs' | 'trailingMean12Obs' | 'zScore'
> {
  const latest = observations[0]?.value ?? null
  const oldest = observations[observations.length - 1]?.value ?? null

  let lookbackPctChange: number | null = null
  if (latest !== null && oldest !== null && oldest !== 0) {
    lookbackPctChange = ((latest - oldest) / Math.abs(oldest)) * 100
  }

  const trailing = observations
    .slice(1, 1 + TRAILING_WINDOW)
    .map((o) => o.value)
    .filter((v): v is number => v !== null)

  let trailingMean12Obs: number | null = null
  let trailingSigma12Obs: number | null = null
  let zScore: number | null = null
  if (trailing.length >= 2) {
    const mean = trailing.reduce((a, b) => a + b, 0) / trailing.length
    const variance =
      trailing.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / trailing.length
    const sigma = Math.sqrt(variance)
    trailingMean12Obs = mean
    trailingSigma12Obs = sigma
    // Constant series (stddev=0) are silently excluded from divergence detection
    // — acceptable because a never-moving series can't diverge.
    if (latest !== null && sigma > 0) {
      zScore = (latest - mean) / sigma
    }
  }

  return { latest, lookbackPctChange, trailingSigma12Obs, trailingMean12Obs, zScore }
}

async function fetchSeries(
  seriesId: string,
  apiKey: string,
  start: Date,
  end: Date,
): Promise<SeriesOutcome> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: start.toISOString().split('T')[0],
    observation_end: end.toISOString().split('T')[0],
    sort_order: 'desc',
    limit: String(OBSERVATIONS_PER_SERIES),
  })

  let res: Response
  try {
    res = await fetchWithTimeout(`${API_BASE}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, errorType: 'timeout' }
    return { ok: false, errorType: 'unknown', message: safeStringify(err) }
  }

  if (!res.ok) {
    if (res.status === 429) {
      return { ok: false, errorType: 'rate_limited', retryAfterSec: parseRetryAfter(res.headers) }
    }
    return { ok: false, errorType: 'external_api_error', statusCode: res.status }
  }

  let data: { observations?: Array<{ date?: string; value?: string }> }
  try {
    data = (await res.json()) as { observations?: Array<{ date?: string; value?: string }> }
  } catch (err) {
    return { ok: false, errorType: 'parse_error', message: safeStringify(err) }
  }

  if (!Array.isArray(data.observations)) {
    return { ok: false, errorType: 'parse_error', message: 'missing observations array' }
  }

  const observations = data.observations.slice(0, OBSERVATIONS_PER_SERIES).map((o) => {
    const raw = o.value
    const v = raw !== undefined && raw !== '.' ? parseFloat(raw) : NaN
    return {
      date: String(o.date ?? ''),
      value: Number.isFinite(v) ? v : null,
    }
  })

  const stats = computeStats(observations)
  return {
    ok: true,
    value: {
      seriesId,
      observations,
      ...stats,
    },
  }
}

export const fredMacroRunner: IntegrationRunner = async (ctx) => {
  const apiKey = process.env.FRED_API_KEY
  const signalSource = 'fred-macro'
  const captureDate = ctx.cluster.firstDetectedAt

  if (!apiKey) {
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'auth_failed',
        provider: 'fred',
        rawSignalQueueId: ctx.queueId,
        message: 'FRED_API_KEY absent in this environment',
      },
      signalSource,
      captureDate,
      haikuSummary: 'Macro signal unavailable — FRED not provisioned for this environment.',
    })
  }

  const seriesIds = seriesForCategory(ctx.cluster.signalCategory)
  const end = ctx.cluster.firstDetectedAt
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  let outcomes: SeriesOutcome[]
  try {
    outcomes = await Promise.all(
      seriesIds.map((s) => fetchSeries(s, apiKey, start, end)),
    )
  } catch (err) {
    // fetchSeries catches its own errors; anything escaping here is
    // something pathological at the Promise.all layer (shouldn't happen,
    // but route it through the canonical shape anyway).
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'unknown',
        rawSignalQueueId: ctx.queueId,
        message: safeStringify(err),
      },
      signalSource,
      captureDate,
      haikuSummary: 'Macro signal unavailable — unexpected error during FRED fetch.',
    })
  }

  const healthy: SeriesResult[] = []
  for (const o of outcomes) {
    if (o.ok) healthy.push(o.value)
  }

  // If no series came back healthy, promote the most-informative failure
  // into a canonical error row. Priority (most actionable first):
  //   rate_limited > timeout > external_api_error > parse_error > unknown
  if (healthy.length === 0) {
    const failures = outcomes.filter((o): o is Extract<SeriesOutcome, { ok: false }> => !o.ok)
    const pick =
      failures.find((f) => f.errorType === 'rate_limited') ??
      failures.find((f) => f.errorType === 'timeout') ??
      failures.find((f) => f.errorType === 'external_api_error') ??
      failures.find((f) => f.errorType === 'parse_error') ??
      failures.find((f) => f.errorType === 'unknown') ??
      failures[0]

    if (pick?.errorType === 'rate_limited') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'rate_limited',
          provider: 'fred',
          rawSignalQueueId: ctx.queueId,
          retryAfterSec: pick.retryAfterSec,
          message: 'FRED rate limit hit on all requested series',
        },
        signalSource,
        captureDate,
        haikuSummary: 'Macro signal unavailable — FRED rate-limited.',
      })
    }
    if (pick?.errorType === 'timeout') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'timeout',
          provider: 'fred',
          rawSignalQueueId: ctx.queueId,
          timeoutMs: TIMEOUT_MS,
          message: 'FRED requests timed out on all requested series',
        },
        signalSource,
        captureDate,
        haikuSummary: 'Macro signal unavailable — FRED timed out.',
      })
    }
    if (pick?.errorType === 'external_api_error') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'external_api_error',
          provider: 'fred',
          rawSignalQueueId: ctx.queueId,
          statusCode: pick.statusCode,
          message: `FRED returned HTTP ${pick.statusCode} on all requested series`,
        },
        signalSource,
        captureDate,
        haikuSummary: 'Macro signal unavailable — FRED upstream error.',
      })
    }
    if (pick?.errorType === 'parse_error') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'parse_error',
          provider: 'fred',
          rawSignalQueueId: ctx.queueId,
          message: `FRED response shape mismatch: ${pick.message}`,
        },
        signalSource,
        captureDate,
        haikuSummary: 'Macro signal unavailable — FRED returned unexpected shape.',
      })
    }
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'unknown',
        rawSignalQueueId: ctx.queueId,
        message: pick?.errorType === 'unknown' ? pick.message : 'All FRED series failed',
      },
      signalSource,
      captureDate,
      haikuSummary: 'Macro signal unavailable — unknown FRED failure.',
    })
  }

  // Confidence ladder by healthy-series count.
  let confidenceLevel: IntegrationResult['confidenceLevel']
  if (healthy.length >= 4) confidenceLevel = 'high'
  else if (healthy.length >= 2) confidenceLevel = 'medium'
  else confidenceLevel = 'low'

  // Divergence: any series with |z| > 2.0 against trailing-3mo mean.
  const divergent = healthy.filter(
    (s) => s.zScore !== null && Math.abs(s.zScore) > DIVERGENCE_Z_THRESHOLD,
  )
  const divergenceFlag = divergent.length > 0
  const divergenceDescription = divergenceFlag
    ? `Divergence detected: ${divergent
        .map(
          (s) =>
            `${s.seriesId} latest=${s.latest?.toFixed(2) ?? 'n/a'} vs 12-obs mean=${s.trailingMean12Obs?.toFixed(2) ?? 'n/a'} (z=${s.zScore?.toFixed(2) ?? 'n/a'})`,
        )
        .join('; ')}`
    : null

  return {
    rawContent: {
      series: healthy,
      seriesRequested: seriesIds,
      seriesHealthyCount: healthy.length,
      lookbackDays: LOOKBACK_DAYS,
    },
    haikuSummary: divergenceFlag
      ? `FRED divergence: ${divergent.length} series beyond 2σ vs trailing window.`
      : `FRED macro captured ${healthy.length}/${seriesIds.length} series; no divergence.`,
    signalSource,
    captureDate,
    coordinates: null,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel,
  }
}
