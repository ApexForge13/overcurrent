/**
 * Discounting Cash Flows (DCF) API client — earnings call transcripts.
 *
 * Target: api.discountingcashflows.com. DCF publishes earnings transcripts
 * for US-listed companies with a REST endpoint:
 *
 *   GET /api/transcript/{ticker}
 *     → Array<{ symbol, quarter, year, date, content }>
 *
 *   GET /api/transcripts-dates   (list-available endpoint, polled)
 *     → Array<{ symbol, quarter, year, date }>
 *
 * ACTUAL API SHAPE: verify at their documentation before first live call.
 * This client is built against the documented spec; if the endpoint paths
 * or response shapes differ, the client functions are the single point
 * of change. Tests use fixtures so they're unaffected.
 *
 * Phase 1c.2b.2 scope:
 *   - T-GT11 fires on transcript availability (no Haiku scoring; Phase 2)
 *   - EarningsSchedule populated as side-effect: next report = last report
 *     + 90 days heuristic per manifest A7
 *
 * ── Env gating ─────────────────────────────────────────────────────────
 * DCF_API_KEY required. Missing → missing-key heartbeat + empty result.
 */

import { fetchWithTimeout } from '@/lib/utils'
import { safeStringify } from '../error-shape'

const BASE_URL = 'https://api.discountingcashflows.com/api'
const TIMEOUT_MS = 20_000

export type DcfFetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; errorType: 'auth_failed' }
  | { ok: false; errorType: 'rate_limited'; retryAfterSec?: number }
  | { ok: false; errorType: 'client_error'; statusCode: number }
  | { ok: false; errorType: 'server_error'; statusCode: number }
  | { ok: false; errorType: 'timeout' }
  | { ok: false; errorType: 'parse_error'; message: string }
  | { ok: false; errorType: 'unknown'; message: string }

/** Calendar entry — what DCF publishes as "latest transcript for ticker". */
export interface DcfTranscriptRef {
  ticker: string
  quarter: number // 1-4
  year: number
  /** ISO date YYYY-MM-DD. */
  reportDate: string
}

/** Full transcript row. */
export interface DcfTranscript extends DcfTranscriptRef {
  content: string
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

async function request(url: string, apiKey: string): Promise<DcfFetchOutcome<unknown>> {
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
    if (res.status >= 500) return { ok: false, errorType: 'server_error', statusCode: res.status }
    return { ok: false, errorType: 'client_error', statusCode: res.status }
  }
  try {
    return { ok: true, value: await res.json() }
  } catch (err) {
    return { ok: false, errorType: 'parse_error', message: safeStringify(err) }
  }
}

/**
 * List recent transcript refs (calendar style). Used by the T-GT11 poller
 * to discover new transcripts. `sinceDate` narrows by report_date.
 */
export async function fetchRecentTranscripts(
  apiKey: string,
  sinceDate?: string,
): Promise<DcfFetchOutcome<DcfTranscriptRef[]>> {
  const qs = sinceDate ? `?since=${encodeURIComponent(sinceDate)}` : ''
  const result = await request(`${BASE_URL}/transcripts-dates${qs}`, apiKey)
  if (!result.ok) return result
  if (!Array.isArray(result.value)) {
    return { ok: false, errorType: 'parse_error', message: 'expected array response' }
  }
  const refs: DcfTranscriptRef[] = []
  for (const raw of result.value as Array<Record<string, unknown>>) {
    const ref = parseTranscriptRef(raw)
    if (ref) refs.push(ref)
  }
  return { ok: true, value: refs }
}

/**
 * Fetch full transcript content for a ticker's latest earnings call.
 */
export async function fetchTranscript(
  ticker: string,
  apiKey: string,
): Promise<DcfFetchOutcome<DcfTranscript>> {
  const result = await request(`${BASE_URL}/transcript/${encodeURIComponent(ticker)}`, apiKey)
  if (!result.ok) return result
  // Endpoint returns an array with the most recent transcript first.
  const arr = Array.isArray(result.value) ? (result.value as Array<Record<string, unknown>>) : null
  const raw = arr && arr.length > 0 ? arr[0] : null
  if (!raw) return { ok: false, errorType: 'parse_error', message: 'no transcript in response' }
  const ref = parseTranscriptRef(raw)
  if (!ref) return { ok: false, errorType: 'parse_error', message: 'transcript missing required fields' }
  const content = typeof raw.content === 'string' ? raw.content : typeof raw.text === 'string' ? raw.text : ''
  return { ok: true, value: { ...ref, content } }
}

export function parseTranscriptRef(raw: Record<string, unknown>): DcfTranscriptRef | null {
  const ticker = String(raw.symbol ?? raw.ticker ?? '').trim().toUpperCase()
  const quarter = parseInt(String(raw.quarter ?? '0'), 10)
  const year = parseInt(String(raw.year ?? '0'), 10)
  const date = String(raw.date ?? raw.report_date ?? '').trim()
  if (!ticker || !quarter || !year || !date) return null
  // Normalize date to ISO YYYY-MM-DD
  const isoDate = normalizeIsoDate(date)
  if (!isoDate) return null
  return { ticker, quarter, year, reportDate: isoDate }
}

export function normalizeIsoDate(raw: string): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}
