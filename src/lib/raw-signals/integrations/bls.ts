/**
 * BLS — US Bureau of Labor Statistics timeseries data.
 *
 * Phase 8 adapter-pivot Pivot 4. Copies the FRED adapter's shape (canonical
 * error-shape, category-driven series, Set-based dedup, TRAILING_WINDOW=12
 * observation statistics, z-score divergence) with three BLS-specific twists
 * called out in the plan:
 *
 *   1. POST endpoint (JSON body), not GET + query-string.
 *   2. API key rides in the body as `registrationkey`, not Authorization
 *      header or query-string. BLS's documented pattern.
 *   3. 400-body parsing discipline: BLS returns HTTP 400 for both quota
 *      exhaustion AND for malformed-request / bad-seriesID / bad-date-range.
 *      A naive "all 400s → rate_limited" mis-routes. We parse the response
 *      body's structured top-level `status` field AND its `message[]` array.
 *      Quota-exhaust is gated on BOTH status==='REQUEST_NOT_PROCESSED' AND
 *      a broadened keyword regex (threshold|quota|limit|exceeded), so a
 *      rewording of the message text (history: 2018 "daily rate" → "daily
 *      threshold") can't silently mis-route. A legacy /daily threshold/i
 *      branch stays as a fallback for responses missing the structured
 *      field. Every other 400 routes to external_api_error with
 *      statusCode=400 and the BLS message text captured.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   BLS_API_KEY (optional, sensitive — raises quota from 25/day anonymous
 *   to 500/day registered). Free registration at
 *   https://data.bls.gov/registrationEngine/.
 *
 *   Sensitive because while the key is free, rotation requires re-
 *   registration. Missing key is NOT auth_failed — BLS is callable
 *   anonymously. A missing key only bites when the 25/day anonymous
 *   quota gets hit, which surfaces as rate_limited via the 400-body
 *   parse above.
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. Per-call cost in CostLog is $0. 500/day quota with key, 25/day
 * anonymous.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Pulls a category-appropriate macro series set from BLS for the cluster
 * context, computes per-series trailing-window stats (latest, 90-day-style
 * lookbackPctChange over oldest-vs-newest in the returned window, mean
 * and stddev over the trailing 12 observations immediately prior to
 * latest), and raises divergenceFlag when any series' latest value
 * crosses |2σ| against its trailing-12 mean.
 *
 * ── Normalization strategy ────────────────────────────────────────────
 * Keyword/category-driven. No per-entity resolution step — series IDs are
 * selected at runtime based on cluster.signalCategory, not cluster.entities.
 * No TickerEntityMap lookup, no CIK resolution, no match-time name variance
 * (exactly like FRED).
 *
 * ── Error routing (canonical error-shape) ─────────────────────────────
 * Every failure path writes a RawSignalLayer row via safeErrorRow with
 * confidenceLevel='unavailable' and a RawSignalError literal:
 *
 *   HTTP 400 body → quota-exhaust      → rate_limited       (provider: 'bls')
 *   HTTP 400 body → other              → external_api_error (+ statusCode=400)
 *   HTTP 429                           → rate_limited       (+ retryAfterSec)
 *   HTTP 4xx/5xx (not 400/429)         → external_api_error (+ statusCode)
 *   HTTP 200 + empty Results.series    → external_api_error (+ statusCode=200)
 *   AbortError / /timeout/i            → timeout            (+ timeoutMs)
 *   JSON unparseable / missing Results → parse_error
 *   Uncaught                           → unknown
 *
 * rawSignalQueueId carried on every variant (Phase 11 dossier FK).
 *
 * ── Graceful degradation ──────────────────────────────────────────────
 * Single POST hits BLS for all requested series at once, so partial-
 * series-failure isn't a thing at the HTTP layer the way it is with
 * FRED's per-series GETs — if the POST returns 200, all series arrive
 * in Results.series (possibly with empty `data` arrays for invalid IDs,
 * which get filtered out and counted as unhealthy for the confidence
 * ladder). If the POST returns non-200, all series fail and the most-
 * informative error is promoted into the canonical row.
 */

import type { IntegrationResult, IntegrationRunner } from '../runner'
import { safeErrorRow, safeStringify, ERROR_VERSION } from '../error-shape'
import { fetchWithTimeout } from '@/lib/utils'

const BLS_TIMEOUT_MS = 15_000
const API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
const OBSERVATIONS_PER_SERIES = 30
const TRAILING_WINDOW = 12
const DIVERGENCE_Z_THRESHOLD = 2.0

// Macro series that apply to every cluster regardless of signalCategory.
//   LNS14000000   — official unemployment rate (seasonally adjusted, civilian)
//   CES0000000001 — all-employee total non-farm payrolls
//   CWUR0000SA0   — CPI, urban wage earners & clerical (all items)
//   PRS85006092   — non-farm business productivity (output per hour)
const DEFAULT_SERIES = [
  'LNS14000000',
  'CES0000000001',
  'CWUR0000SA0',
  'PRS85006092',
] as const

// Category-specific additions layered on top of DEFAULT_SERIES.
//   EIUIR — import price index (all commodities)
const TRADE_EXTRA = ['EIUIR'] as const

function seriesForCategory(category: string | null): string[] {
  const set = new Set<string>(DEFAULT_SERIES)
  if (category === 'trade_dispute') {
    for (const s of TRADE_EXTRA) set.add(s)
  }
  return Array.from(set)
}

interface SeriesResult {
  seriesId: string
  observations: Array<{ date: string; value: number | null }>
  latest: number | null
  /**
   * Percent change from oldest to latest observation in the returned
   * window (~OBSERVATIONS_PER_SERIES months back on monthly data).
   * Named lookbackPctChange (not YoY) because the window is observation-
   * count based, not calendar-year anchored.
   */
  lookbackPctChange: number | null
  /**
   * Trailing TRAILING_WINDOW observations (12), the 12 observations
   * immediately prior to `latest`. Matches FRED's field naming.
   */
  trailingSigma12Obs: number | null
  trailingMean12Obs: number | null
  zScore: number | null
}

/**
 * Convert a BLS {year, period} pair to an ISO date string. Period "M03"
 * → month=3 day=1. Quarterly ("Q01"..Q04"), annual ("A01") and semi-
 * annual ("S01"/"S02") periods are folded to the first month of the
 * quarter / January / July respectively — good enough for observation
 * ordering; we don't surface the date granularity elsewhere.
 */
function bpsPeriodToISO(year: string, period: string): string {
  const y = parseInt(year, 10)
  if (!Number.isFinite(y)) return ''
  let month = 1
  if (/^M\d{2}$/.test(period)) {
    const m = parseInt(period.slice(1), 10)
    if (Number.isFinite(m) && m >= 1 && m <= 12) month = m
  } else if (/^Q0[1-4]$/.test(period)) {
    const q = parseInt(period.slice(1), 10)
    month = (q - 1) * 3 + 1
  } else if (period === 'S02') {
    month = 7
  }
  const d = new Date(Date.UTC(y, month - 1, 1))
  return d.toISOString().split('T')[0]
}

/**
 * Compute stats over a series' observations (newest-first).
 *   - latest: first non-null in the desc-sorted list
 *   - lookbackPctChange: pct change from oldest to latest in the window
 *   - trailingMean12Obs / trailingSigma12Obs: mean and population stddev
 *     over indices 1..12 (the 12 obs immediately before `latest`)
 *   - zScore: (latest - mean) / sigma, guarded for /0 and constant series
 *
 * Math copied verbatim from FRED (fred-macro.ts:computeStats).
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
    // Constant series (stddev=0) are silently excluded from divergence —
    // a never-moving series can't diverge.
    if (latest !== null && sigma > 0) {
      zScore = (latest - mean) / sigma
    }
  }

  return { latest, lookbackPctChange, trailingSigma12Obs, trailingMean12Obs, zScore }
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

/**
 * Promote a raw BLS series (from Results.series[]) into a SeriesResult.
 * BLS returns data newest-first already. Values are strings — parse to
 * float, treat non-finite as null.
 */
function normalizeSeries(raw: {
  seriesID: string
  data: Array<{ year?: string; period?: string; value?: string }>
}): SeriesResult {
  const observations = (raw.data ?? [])
    .slice(0, OBSERVATIONS_PER_SERIES)
    .map((o) => {
      const v = o.value !== undefined && o.value !== '' ? parseFloat(o.value) : NaN
      return {
        date: bpsPeriodToISO(String(o.year ?? ''), String(o.period ?? '')),
        value: Number.isFinite(v) ? v : null,
      }
    })
  const stats = computeStats(observations)
  return {
    seriesId: raw.seriesID,
    observations,
    ...stats,
  }
}

export const blsRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const apiKey = process.env.BLS_API_KEY
  const signalSource = 'bls'
  const captureDate = ctx.cluster.firstDetectedAt

  const seriesIds = seriesForCategory(ctx.cluster.signalCategory)
  const endYear = ctx.cluster.firstDetectedAt.getUTCFullYear()
  // OBSERVATIONS_PER_SERIES=30 months ≈ 2.5 years; widen the window a
  // year on each side so the trailing-12 + oldest-latest math has room.
  const startYear = endYear - 3

  const postBody: {
    seriesid: string[]
    startyear: string
    endyear: string
    registrationkey?: string
  } = {
    seriesid: seriesIds,
    startyear: String(startYear),
    endyear: String(endYear),
  }
  if (apiKey) postBody.registrationkey = apiKey

  let res: Response
  try {
    res = await fetchWithTimeout(API_BASE, BLS_TIMEOUT_MS, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postBody),
    })
  } catch (err) {
    if (isTimeoutError(err)) {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'timeout',
          provider: 'bls',
          rawSignalQueueId: ctx.queueId,
          timeoutMs: BLS_TIMEOUT_MS,
          message: `BLS request timed out after ${BLS_TIMEOUT_MS}ms`,
        },
        signalSource,
        captureDate,
        haikuSummary: 'BLS signal unavailable — request timed out.',
      })
    }
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'unknown',
        rawSignalQueueId: ctx.queueId,
        message: safeStringify(err),
      },
      signalSource,
      captureDate,
      haikuSummary: 'BLS signal unavailable — unexpected error during BLS fetch.',
    })
  }

  // HTTP 400 needs body inspection — BLS overloads 400 for both quota
  // exhaustion and generic request errors. See file header for rationale.
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}))
    const messages = Array.isArray((body as { message?: unknown }).message)
      ? ((body as { message: unknown[] }).message as unknown[]).map((m) => String(m)).join(' ')
      : ''
    const bodyStatus =
      typeof (body as { status?: unknown }).status === 'string'
        ? (body as { status: string }).status
        : ''

    // Structured signal: BLS emits status='REQUEST_NOT_PROCESSED' on quota
    // exhaust AND the message typically contains a threshold/quota/limit
    // keyword. Require BOTH the structured status AND a broadened keyword
    // regex so that:
    //   - a reworded message doesn't silently mis-route (structured status
    //     catches it — history: 2018 "daily rate" → "daily threshold")
    //   - a REQUEST_NOT_PROCESSED meaning something unrelated later doesn't
    //     false-positive quota-exhaust
    // The legacy /daily threshold/i branch stays in place as a belt-and-
    // suspenders fallback in case some legacy BLS response omits the
    // structured field but keeps the historical phrasing.
    const quotaByStatus =
      bodyStatus === 'REQUEST_NOT_PROCESSED' &&
      /threshold|quota|limit|exceeded/i.test(messages)
    const quotaByMessage = /daily threshold/i.test(messages)
    if (quotaByStatus || quotaByMessage) {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'rate_limited',
          provider: 'bls',
          rawSignalQueueId: ctx.queueId,
          message: messages || 'BLS daily quota exhausted',
        },
        signalSource,
        captureDate,
        haikuSummary: 'BLS signal unavailable — daily quota exhausted.',
      })
    }
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'external_api_error',
        provider: 'bls',
        rawSignalQueueId: ctx.queueId,
        statusCode: 400,
        message: messages || 'BLS returned HTTP 400 with no message body',
      },
      signalSource,
      captureDate,
      haikuSummary: 'BLS signal unavailable — BLS rejected the request (HTTP 400).',
    })
  }

  if (!res.ok) {
    if (res.status === 429) {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'rate_limited',
          provider: 'bls',
          rawSignalQueueId: ctx.queueId,
          retryAfterSec: parseRetryAfter(res.headers),
          message: 'BLS rate limit hit (HTTP 429)',
        },
        signalSource,
        captureDate,
        haikuSummary: 'BLS signal unavailable — rate-limited.',
      })
    }
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'external_api_error',
        provider: 'bls',
        rawSignalQueueId: ctx.queueId,
        statusCode: res.status,
        message: `BLS returned HTTP ${res.status}`,
      },
      signalSource,
      captureDate,
      haikuSummary: 'BLS signal unavailable — BLS upstream error.',
    })
  }

  // Parse the 200 body. Shape:
  //   { status, responseTime, message, Results: { series: [...] } }
  let data: {
    status?: string
    message?: unknown
    Results?: { series?: Array<{ seriesID?: string; data?: unknown }> }
  }
  try {
    data = (await res.json()) as typeof data
  } catch (err) {
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'parse_error',
        provider: 'bls',
        rawSignalQueueId: ctx.queueId,
        message: `BLS JSON parse failed: ${safeStringify(err)}`,
      },
      signalSource,
      captureDate,
      haikuSummary: 'BLS signal unavailable — JSON parse failed.',
    })
  }

  const rawSeries = data.Results?.series
  if (!Array.isArray(rawSeries)) {
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'parse_error',
        provider: 'bls',
        rawSignalQueueId: ctx.queueId,
        message: 'BLS response missing Results.series array',
      },
      signalSource,
      captureDate,
      haikuSummary: 'BLS signal unavailable — response shape unexpected.',
    })
  }

  // Promote each series and count healthy ones (at least 1 observation).
  const promoted: SeriesResult[] = rawSeries.map((s) =>
    normalizeSeries(
      s as { seriesID: string; data: Array<{ year?: string; period?: string; value?: string }> },
    ),
  )
  const healthy = promoted.filter((s) => s.observations.length > 0)

  if (healthy.length === 0) {
    // Empty series array — BLS returned a structurally-valid 200 response
    // but every series we queried came back with zero observations. Most
    // common cause: one or more seriesIDs in our default+category set are
    // invalid (request-side bug). Second most common: BLS upstream
    // degradation. Either way, the response IS valid — parse_error is the
    // wrong fit (parse_error now only fires for genuine shape-unparseable
    // cases: JSON parse failure or missing Results.series). Route to
    // external_api_error with statusCode=200 so Phase 11's admin-signals
    // renderer can filter by errorType==='external_api_error' &&
    // statusCode===200 and surface this specific operational bucket
    // separately from real 4xx/5xx upstream outages.
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'external_api_error',
        provider: 'bls',
        rawSignalQueueId: ctx.queueId,
        statusCode: 200,
        message: safeStringify(
          'BLS returned 200 with empty Results.series — likely request-side (invalid seriesID) or upstream degradation',
        ),
      },
      signalSource,
      captureDate,
      haikuSummary: 'BLS signal unavailable — 200 response with empty series data.',
    })
  }

  // Confidence ladder by healthy-series count (same ladder as FRED).
  let confidenceLevel: IntegrationResult['confidenceLevel']
  if (healthy.length >= 4) confidenceLevel = 'high'
  else if (healthy.length >= 2) confidenceLevel = 'medium'
  else confidenceLevel = 'low'

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
      trailingWindow: TRAILING_WINDOW,
      observationsPerSeries: OBSERVATIONS_PER_SERIES,
    },
    haikuSummary: divergenceFlag
      ? `BLS divergence: ${divergent.length} series beyond 2σ vs trailing window.`
      : `BLS captured ${healthy.length}/${seriesIds.length} series; no divergence.`,
    signalSource,
    captureDate,
    coordinates: null,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel,
  }
}
