/**
 * SEC EDGAR full-text search client.
 *
 * Pure fetch + parse module. No cluster context, no trigger logic, no
 * persistence. Used by:
 *   - Legacy src/lib/raw-signals/integrations/sec-edgar.ts (entity-by-cluster
 *     searches for the gated debate pipeline)
 *   - Phase 1c.2a trigger implementations T-GT1/T-GT2/T-GT3 (cursor-based
 *     polling for recently-landed filings, no entity filter)
 *
 * ── Error routing ────────────────────────────────────────────────────────
 *   HTTP 403                     → auth_failed
 *   HTTP 429                     → rate_limited (+ retryAfterSec)
 *   HTTP 4xx (non-429) / 5xx     → external_api_error (+ statusCode)
 *   AbortError / /timeout/i      → timeout
 *   200 but `hits` missing       → parse_error
 *   Other                        → unknown
 *
 * ── User agent ───────────────────────────────────────────────────────────
 * SEC requires a descriptive User-Agent identifying the requester. Missing
 * or generic UA triggers 403 → auth_failed. Default UA embeds the admin
 * email; override with SEC_EDGAR_USER_AGENT env var for production.
 */

import { fetchWithTimeout } from '@/lib/utils'
import { safeStringify } from '../error-shape'

const TIMEOUT_MS = 20_000
export const FULL_TEXT_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index'
export const DEFAULT_USER_AGENT =
  process.env.SEC_EDGAR_USER_AGENT ?? 'Overcurrent/1.0 connermhecht13@gmail.com'

/** A single hit from EDGAR full-text search, normalized. */
export interface SecFilingHit {
  accessionNumber: string
  /** ISO date string (YYYY-MM-DD). */
  filedAt: string
  formType: string
  displayNames: string[]
  ciks: string[]
  tickers: string[]
  periodOfReport?: string
  summary?: string
}

export type SecFetchOutcome =
  | { ok: true; hits: SecFilingHit[] }
  | { ok: false; errorType: 'auth_failed' }
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
 * Convert a YYYY-MM-DD-ish date string to a Date. Returns null if the
 * string is not a recognizable date.
 */
export function parseSecDate(filedAt: string): Date | null {
  const d = new Date(filedAt)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * Build EDGAR absolute URL for a filing from the accession number.
 * Canonical form: https://www.sec.gov/Archives/edgar/data/{CIK}/{ACC_NODASH}/{ACC}-index.htm
 */
export function accessionToUrl(accession: string, cik?: string): string {
  const noDashes = accession.replace(/-/g, '')
  const cikPath = cik ? cik.replace(/^0+/, '') : ''
  if (cikPath) {
    return `https://www.sec.gov/Archives/edgar/data/${cikPath}/${noDashes}/${accession}-index.htm`
  }
  return `https://efts.sec.gov/LATEST/search-index?q=${accession}`
}

/**
 * Extract readable filer name from EDGAR's display_names format:
 *   "Acme Corporation (CIK 0000000123) (Filer)"
 */
export function cleanFilerName(raw: string): string {
  return raw.replace(/\s*\(CIK[^)]*\)/gi, '').replace(/\s*\(Filer\)/gi, '').trim()
}

/**
 * Low-level fetch helper — runs one EDGAR full-text search query with the
 * given URL parameters. Normalizes the response into SecFetchOutcome.
 * Callers build the URLSearchParams.
 */
async function runSearch(params: URLSearchParams, userAgent: string): Promise<SecFetchOutcome> {
  let res: Response
  try {
    res = await fetchWithTimeout(`${FULL_TEXT_SEARCH_URL}?${params}`, TIMEOUT_MS, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    })
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, errorType: 'timeout' }
    return { ok: false, errorType: 'unknown', message: safeStringify(err) }
  }

  if (!res.ok) {
    if (res.status === 403) return { ok: false, errorType: 'auth_failed' }
    if (res.status === 429) {
      return { ok: false, errorType: 'rate_limited', retryAfterSec: parseRetryAfter(res.headers) }
    }
    return { ok: false, errorType: 'external_api_error', statusCode: res.status }
  }

  let data: { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } }
  try {
    data = (await res.json()) as typeof data
  } catch (err) {
    return { ok: false, errorType: 'parse_error', message: safeStringify(err) }
  }

  const rawHits = data.hits?.hits
  if (!Array.isArray(rawHits)) {
    return { ok: false, errorType: 'parse_error', message: 'missing hits.hits array' }
  }

  const hits: SecFilingHit[] = rawHits.map((h) => {
    const s = h._source ?? {}
    return {
      accessionNumber: String(s.adsh ?? ''),
      filedAt: String(s.file_date ?? ''),
      formType: String(s.form ?? ''),
      displayNames: Array.isArray(s.display_names) ? (s.display_names as string[]) : [],
      ciks: Array.isArray(s.ciks) ? (s.ciks as string[]) : [],
      tickers: Array.isArray(s.tickers) ? (s.tickers as string[]) : [],
      periodOfReport: s.period_of_report ? String(s.period_of_report) : undefined,
      summary: s.xsl ? String(s.xsl).substring(0, 200) : undefined,
    }
  })
  return { ok: true, hits }
}

export interface SearchByEntityParams {
  entities: string[]
  /** Reference date — search runs from (since - windowDays) to since. */
  since: Date
  windowDays?: number
  /** Form types to filter to. Default includes the legacy-adapter set. */
  forms?: string[]
  maxHits?: number
  userAgent?: string
}

/**
 * Entity-scoped search. Used by the legacy cluster-context adapter.
 * Quotes each entity and ORs them together in the EDGAR full-text query.
 */
export async function searchByEntity(params: SearchByEntityParams): Promise<SecFetchOutcome> {
  const windowDays = params.windowDays ?? 90
  const maxHits = params.maxHits ?? 25
  const forms = params.forms ?? ['8-K', '4', '13F-HR', 'SC 13D', 'SC 13G', 'DEF 14A']
  const userAgent = params.userAgent ?? DEFAULT_USER_AGENT

  const start = new Date(params.since.getTime() - windowDays * 24 * 60 * 60 * 1000)
  const search = new URLSearchParams({
    q: `"${params.entities.join('" OR "')}"`,
    forms: forms.join(','),
    dateRange: 'custom',
    startdt: start.toISOString().split('T')[0],
    enddt: params.since.toISOString().split('T')[0],
  })

  const outcome = await runSearch(search, userAgent)
  if (outcome.ok) {
    return { ok: true, hits: outcome.hits.slice(0, maxHits) }
  }
  return outcome
}

export interface PollRecentFilingsParams {
  /**
   * Fetch filings with filedAt > sinceCursor. ISO date string. If undefined,
   * defaults to 48h before `now` so the first poll doesn't ingest years of
   * history. Callers should persist the cursor after a successful poll and
   * pass it back next scan.
   */
  sinceCursor?: string
  /** Form types to fetch. Required — no default, triggers pass explicit set. */
  forms: string[]
  /** Upper bound (inclusive) for the window. Defaults to now. */
  until?: Date
  /** Hard cap on returned hits. Defaults to 100. */
  maxHits?: number
  userAgent?: string
}

/**
 * Cursor-based poll for recently-landed filings matching the given form
 * types. No entity filter — the caller resolves hits to TrackedEntity via
 * CIK/ticker lookup after the fact.
 *
 * Advances the cursor on the caller side: the caller picks the max filedAt
 * from the returned hits and passes that (or a slightly-later ISO date) as
 * `sinceCursor` on the next scan.
 */
export async function pollRecentFilings(params: PollRecentFilingsParams): Promise<SecFetchOutcome> {
  const maxHits = params.maxHits ?? 100
  const userAgent = params.userAgent ?? DEFAULT_USER_AGENT
  const until = params.until ?? new Date()

  let startIso: string
  if (params.sinceCursor) {
    const parsed = parseSecDate(params.sinceCursor)
    if (!parsed) {
      return {
        ok: false,
        errorType: 'parse_error',
        message: `invalid sinceCursor: ${params.sinceCursor}`,
      }
    }
    startIso = parsed.toISOString().split('T')[0]
  } else {
    const twoDaysAgo = new Date(until.getTime() - 48 * 60 * 60 * 1000)
    startIso = twoDaysAgo.toISOString().split('T')[0]
  }

  const search = new URLSearchParams({
    forms: params.forms.join(','),
    dateRange: 'custom',
    startdt: startIso,
    enddt: until.toISOString().split('T')[0],
  })

  const outcome = await runSearch(search, userAgent)
  if (outcome.ok) {
    // Sort by filedAt ascending so the caller can trivially take the max
    // as the next cursor. EDGAR returns results in reverse-chronological by
    // default, but we don't rely on that.
    const sorted = [...outcome.hits].sort((a, b) => a.filedAt.localeCompare(b.filedAt))
    return { ok: true, hits: sorted.slice(0, maxHits) }
  }
  return outcome
}

// ── Bucketing helpers ────────────────────────────────────────────────────

export type Form4Type = '4' | '4/A'
export type F13Type = '13F-HR' | '13F-HR/A'
export type D13Type = 'SC 13D' | 'SC 13G' | 'SC 13D/A' | 'SC 13G/A'

export interface Form4Trade {
  filerCik?: string
  filerName: string
  ticker?: string
  filingDate: string
  formType: Form4Type
  accessionNumber: string
  absoluteUrl: string
}

export interface F13Holding {
  filerCik?: string
  filerName: string
  filingDate: string
  reportDate?: string
  formType: F13Type
  accessionNumber: string
  absoluteUrl: string
}

export interface D13Filing {
  filerCik?: string
  filerName: string
  ticker?: string
  filingDate: string
  formType: D13Type
  accessionNumber: string
  absoluteUrl: string
}

/**
 * Bucket raw SEC filing hits into structured per-form arrays. Form types
 * that don't match any bucket (8-K, DEF 14A, etc.) are dropped from the
 * structured arrays — callers that need 8-K filings should iterate the
 * original hit list filtered by formType.
 */
export function bucketHits(hits: SecFilingHit[]): {
  form4Trades: Form4Trade[]
  f13Holdings: F13Holding[]
  d13Filings: D13Filing[]
} {
  const form4Trades: Form4Trade[] = []
  const f13Holdings: F13Holding[] = []
  const d13Filings: D13Filing[] = []

  for (const h of hits) {
    const filerName = cleanFilerName(h.displayNames[0] ?? '')
    const filerCik = h.ciks[0] ?? undefined
    const ticker = h.tickers[0]
    const url = accessionToUrl(h.accessionNumber, filerCik)

    if (h.formType === '4' || h.formType === '4/A') {
      form4Trades.push({
        filerCik,
        filerName,
        ticker,
        filingDate: h.filedAt,
        formType: h.formType as Form4Type,
        accessionNumber: h.accessionNumber,
        absoluteUrl: url,
      })
    } else if (h.formType === '13F-HR' || h.formType === '13F-HR/A') {
      f13Holdings.push({
        filerCik,
        filerName,
        filingDate: h.filedAt,
        reportDate: h.periodOfReport,
        formType: h.formType as F13Type,
        accessionNumber: h.accessionNumber,
        absoluteUrl: url,
      })
    } else if (h.formType.startsWith('SC 13D') || h.formType.startsWith('SC 13G')) {
      d13Filings.push({
        filerCik,
        filerName,
        ticker,
        filingDate: h.filedAt,
        formType: h.formType as D13Type,
        accessionNumber: h.accessionNumber,
        absoluteUrl: url,
      })
    }
  }
  return { form4Trades, f13Holdings, d13Filings }
}
