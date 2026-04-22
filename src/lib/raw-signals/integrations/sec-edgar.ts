/**
 * SEC EDGAR — public filings (Form 4 insider trades, 13F institutional
 * holdings, 13D/G activist stakes, plus 8-K / DEF 14A for narrative context).
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   SEC_EDGAR_USER_AGENT (recommended; defaults to admin email)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. SEC requires a descriptive User-Agent identifying the requester.
 * A generic or missing UA triggers 403 — routed here as auth_failed.
 *
 * ── Match-time normalization ─────────────────────────────────────────
 * SEC EDGAR full-text search is case-insensitive and tokenizes on its own
 * side, so cluster entities go in as-is with no client-side normalization.
 * This is the normalization-direction choice: pre-query capitalization /
 * accent handling is SEC's responsibility, not ours. No per-entity CIK
 * resolution step either — we rely on full-text match across display_names.
 *
 * ── SEC_EDGAR_USER_AGENT pre-production flag ─────────────────────────
 * Default UA embeds Conner's personal email. Before Production cutover
 * this should flip to a domain address (ops@overcurrent.news or similar).
 * Non-blocking; flagged in the adapter-pivot plan §6.
 *
 * ── Structured-extension scope note ──────────────────────────────────
 * This adapter captures filing metadata (filer identity, filing date,
 * accession number, form type). Form 4 XML deep-parse — transaction
 * code, shares, price-per-share — is a follow-up task. Divergence on
 * insider activity therefore uses a COUNT threshold (≥3 Form 4 in the
 * 30-day pre-window), not a dollar-volume threshold.
 *
 * ── Error routing (canonical error-shape) ─────────────────────────────
 * Every failure path writes a RawSignalLayer row via safeErrorRow with
 * confidenceLevel='unavailable' and a RawSignalError discriminated-union
 * literal:
 *
 *   HTTP 403                     → auth_failed          (provider: 'sec_edgar')
 *   HTTP 429                     → rate_limited         (+ retryAfterSec)
 *   HTTP 4xx (non-429) / 5xx     → external_api_error   (+ statusCode)
 *   AbortError / /timeout/i      → timeout              (+ timeoutMs)
 *   200 but `hits` missing       → parse_error
 *   Entities degenerate (<3 chr) → resolution_failed    (+ attemptedKey)
 *   Uncaught                     → unknown
 *
 * rawSignalQueueId is carried on every variant (Phase 11 dossier FK).
 *
 * ── Divergence rule (aggregate, not per-form) ─────────────────────────
 * divergenceFlag is TRUE when any of:
 *   1. ≥3 Form 4 filings in the 30-day window before firstDetectedAt
 *      (insider activity cluster)
 *   2. ≥1 SC 13D filing in the 30-day window (activist stake disclosure
 *      is materially newsworthy)
 *   3. Haiku assessment returns addsMissingContext=true AND ≥2 hits
 *      (below-threshold soft signal, consistent with CourtListener)
 * divergenceDescription enumerates which conditions fired.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationResult, IntegrationRunner } from '../runner'
import { safeErrorRow, safeStringify, ERROR_VERSION } from '../error-shape'

const TIMEOUT_MS = 20_000
const FULL_TEXT_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index'
const USER_AGENT =
  process.env.SEC_EDGAR_USER_AGENT ?? 'Overcurrent/1.0 connermhecht13@gmail.com'
const WINDOW_DAYS = 90
const DIVERGENCE_WINDOW_DAYS = 30
const FORM4_DIVERGENCE_COUNT = 3
const MAX_HITS = 25

type Form4Type = '4' | '4/A'
type F13Type = '13F-HR' | '13F-HR/A'
type D13Type = 'SC 13D' | 'SC 13G' | 'SC 13D/A' | 'SC 13G/A'

interface Form4Trade {
  filerCik?: string
  filerName: string
  ticker?: string
  filingDate: string
  formType: Form4Type
  accessionNumber: string
  absoluteUrl: string
}

interface F13Holding {
  filerCik?: string
  filerName: string
  filingDate: string
  reportDate?: string
  formType: F13Type
  accessionNumber: string
  absoluteUrl: string
}

interface D13Filing {
  filerCik?: string
  filerName: string
  ticker?: string
  filingDate: string
  formType: D13Type
  accessionNumber: string
  absoluteUrl: string
}

interface RawHit {
  accessionNumber: string
  filedAt: string
  formType: string
  displayNames: string[]
  ciks: string[]
  tickers: string[]
  periodOfReport?: string
  summary?: string
}

type FetchOutcome =
  | { ok: true; hits: RawHit[] }
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
 * Build EDGAR absolute URL for a filing from the accession number.
 * Format: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&...
 * simplified here to the canonical archives URL pattern.
 */
function accessionToUrl(accession: string, cik?: string): string {
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
 * Strips the "(CIK …)" and "(Filer)" parenthetical suffixes.
 */
function cleanFilerName(raw: string): string {
  return raw.replace(/\s*\(CIK[^)]*\)/gi, '').replace(/\s*\(Filer\)/gi, '').trim()
}

async function runEdgarSearch(entities: string[], since: Date): Promise<FetchOutcome> {
  const start = new Date(since.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    q: `"${entities.join('" OR "')}"`,
    forms: '8-K,4,13F-HR,SC 13D,SC 13G,DEF 14A',
    dateRange: 'custom',
    startdt: start.toISOString().split('T')[0],
    enddt: since.toISOString().split('T')[0],
  })

  let res: Response
  try {
    res = await fetchWithTimeout(`${FULL_TEXT_SEARCH_URL}?${params}`, TIMEOUT_MS, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
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

  const hits: RawHit[] = rawHits.slice(0, MAX_HITS).map((h) => {
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

/**
 * Bucket raw hits into structured per-form arrays. Hits whose form type
 * doesn't match any bucket (8-K, DEF 14A, etc.) are dropped from the
 * structured arrays but still factor into the raw hit count that Haiku
 * sees and that feeds the confidence ladder.
 *
 * Note on ticker extraction: EDGAR's full-text search doesn't guarantee a
 * `tickers` field on every hit — only certain form types and only when the
 * issuer is exchange-listed. When absent we leave ticker: undefined and
 * let the Phase 11 dossier renderer fall back to filer-only rows.
 */
function bucketHits(hits: RawHit[]): {
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

const HAIKU_SYSTEM = `You assess SEC EDGAR filings against news coverage.
Given a story and filings matching cluster entities in the 90-day pre-story window, return:
- filingsRelevant: count of filings truly about the same entity/event as the story
- materialFilings: count that are 8-K material-event filings, Form 4 insider trades, or SC 13D activist stakes
- addsMissingContext: true if a material filing adds context the narrative omits or contradicts it
- gapDescription: 1-2 sentences or empty
Return JSON only:
{ "filingsRelevant": 0, "materialFilings": 0, "addsMissingContext": false, "gapDescription": "" }`

interface HaikuAssessment {
  filingsRelevant: number
  materialFilings: number
  addsMissingContext: boolean
  gapDescription: string
}

function inWindow(filedAt: string, reference: Date, windowDays: number): boolean {
  const filed = new Date(filedAt)
  if (!Number.isFinite(filed.getTime())) return false
  const diffMs = reference.getTime() - filed.getTime()
  if (diffMs < 0) return false
  return diffMs <= windowDays * 24 * 60 * 60 * 1000
}

export const secEdgarRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const signalSource = 'sec-edgar'
  const captureDate = ctx.cluster.firstDetectedAt

  // ── Resolution step: filter entities to valid full-text query tokens. ──
  // SEC full-text search stems on its own side, but we still reject
  // degenerate input (1-char tokens or not starting with a capital) so
  // we don't send noise queries. If nothing survives, that's a
  // resolution_failed error — the cluster's entities can't be resolved
  // into a meaningful EDGAR query.
  //
  // Keep 2+ char uppercased tokens: covers 2-letter (F, T) and 3-letter
  // (IBM, GE, CME, AMC) tickers plus longer proper nouns. A length>3
  // cutoff would silently drop mega-cap tickers whose insider-trade
  // activity is the highest-signal cohort for this adapter.
  const keywords = ctx.cluster.entities
    .filter((e) => e.length >= 2 && /^[A-Z]/.test(e))
    .slice(0, 3)

  if (keywords.length === 0) {
    const attemptedKey = ctx.cluster.entities.slice(0, 3).join(' | ') || '(empty entities)'
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'resolution_failed',
        rawSignalQueueId: ctx.queueId,
        attemptedKey,
        message: 'No cluster entities resolvable to EDGAR full-text query (all tokens <2 chars or lowercase-led)',
      },
      signalSource,
      captureDate,
      haikuSummary: 'SEC EDGAR unavailable — cluster entities not resolvable to a query.',
    })
  }

  // ── Upstream fetch ─────────────────────────────────────────────────
  let outcome: FetchOutcome
  try {
    outcome = await runEdgarSearch(keywords, ctx.cluster.firstDetectedAt)
  } catch (err) {
    // runEdgarSearch catches its own errors; anything escaping here is
    // pathological (shouldn't happen, but route it through canonical shape).
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'unknown',
        rawSignalQueueId: ctx.queueId,
        message: safeStringify(err),
      },
      signalSource,
      captureDate,
      haikuSummary: 'SEC EDGAR unavailable — unexpected error during fetch.',
    })
  }

  if (!outcome.ok) {
    if (outcome.errorType === 'auth_failed') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'auth_failed',
          provider: 'sec_edgar',
          rawSignalQueueId: ctx.queueId,
          message: 'EDGAR returned 403 — User-Agent rejected (missing or too generic)',
        },
        signalSource,
        captureDate,
        haikuSummary: 'SEC EDGAR unavailable — User-Agent rejected.',
      })
    }
    if (outcome.errorType === 'rate_limited') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'rate_limited',
          provider: 'sec_edgar',
          rawSignalQueueId: ctx.queueId,
          retryAfterSec: outcome.retryAfterSec,
          message: 'EDGAR rate limit hit (429)',
        },
        signalSource,
        captureDate,
        haikuSummary: 'SEC EDGAR unavailable — rate-limited.',
      })
    }
    if (outcome.errorType === 'timeout') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'timeout',
          provider: 'sec_edgar',
          rawSignalQueueId: ctx.queueId,
          timeoutMs: TIMEOUT_MS,
          message: 'EDGAR full-text search request timed out',
        },
        signalSource,
        captureDate,
        haikuSummary: 'SEC EDGAR unavailable — request timed out.',
      })
    }
    if (outcome.errorType === 'external_api_error') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'external_api_error',
          provider: 'sec_edgar',
          rawSignalQueueId: ctx.queueId,
          statusCode: outcome.statusCode,
          message: `EDGAR returned HTTP ${outcome.statusCode}`,
        },
        signalSource,
        captureDate,
        haikuSummary: 'SEC EDGAR unavailable — upstream error.',
      })
    }
    if (outcome.errorType === 'parse_error') {
      return safeErrorRow({
        error: {
          errorVersion: ERROR_VERSION,
          errorType: 'parse_error',
          provider: 'sec_edgar',
          rawSignalQueueId: ctx.queueId,
          message: `EDGAR response shape mismatch: ${outcome.message}`,
        },
        signalSource,
        captureDate,
        haikuSummary: 'SEC EDGAR unavailable — response shape unexpected.',
      })
    }
    // outcome.errorType === 'unknown'
    return safeErrorRow({
      error: {
        errorVersion: ERROR_VERSION,
        errorType: 'unknown',
        rawSignalQueueId: ctx.queueId,
        message: outcome.message,
      },
      signalSource,
      captureDate,
      haikuSummary: 'SEC EDGAR unavailable — unknown fetch failure.',
    })
  }

  const hits = outcome.hits
  const { form4Trades, f13Holdings, d13Filings } = bucketHits(hits)

  // Empty-hits is a low-confidence success, not an error — EDGAR
  // answered the query, just with zero matches. Happens routinely for
  // clusters about non-public entities (private companies, individuals
  // without filings).
  if (hits.length === 0) {
    return {
      rawContent: {
        form4Trades: [],
        f13Holdings: [],
        d13Filings: [],
        queryKeywords: keywords,
        windowDays: WINDOW_DAYS,
        hitCount: 0,
      },
      haikuSummary: 'No SEC EDGAR filings for entities in 90-day window.',
      signalSource,
      captureDate,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low',
    }
  }

  // ── Haiku materiality assessment (supplementary, not primary) ─────
  let assessment: HaikuAssessment = {
    filingsRelevant: 0,
    materialFilings: 0,
    addsMissingContext: false,
    gapDescription: '',
  }
  let haikuCost = 0
  let haikuOk = false
  try {
    const r = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${ctx.cluster.headline}\n\nSummary: ${ctx.cluster.synopsis.substring(0, 1200)}\n\nEntities: ${ctx.cluster.entities.slice(0, 6).join(', ')}\n\nFilings:\n${hits.slice(0, 12).map((f, i) => `${i + 1}. ${f.formType} | ${f.filedAt} | ${f.displayNames.slice(0, 2).join('; ')}`).join('\n')}`,
      agentType: 'raw_signal_sec_edgar',
      maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
    haikuOk = true
  } catch (err) {
    // Haiku failure is non-fatal — we still have structured arrays and
    // can return a medium/low confidence result. Log and move on.
    console.warn(
      '[raw-signals/sec-edgar] Haiku assessment failed:',
      err instanceof Error ? err.message : err,
    )
  }

  // ── Divergence computation (aggregate across conditions) ──────────
  const reference = ctx.cluster.firstDetectedAt
  const form4In30d = form4Trades.filter((f) => inWindow(f.filingDate, reference, DIVERGENCE_WINDOW_DAYS))
  const d13In30d = d13Filings.filter((f) =>
    f.formType.startsWith('SC 13D') && inWindow(f.filingDate, reference, DIVERGENCE_WINDOW_DAYS),
  )

  const conditionFired: string[] = []
  if (form4In30d.length >= FORM4_DIVERGENCE_COUNT) {
    conditionFired.push(
      `insider activity cluster: ${form4In30d.length} Form 4 filings in ${DIVERGENCE_WINDOW_DAYS}-day pre-window`,
    )
  }
  if (d13In30d.length >= 1) {
    conditionFired.push(
      `activist stake disclosure: ${d13In30d.length} SC 13D filing(s) in ${DIVERGENCE_WINDOW_DAYS}-day pre-window`,
    )
  }
  if (assessment.addsMissingContext && hits.length >= 2) {
    conditionFired.push(
      `Haiku materiality signal: ${assessment.gapDescription || 'narrative gap detected'}`,
    )
  }

  const divergenceFlag = conditionFired.length > 0
  const divergenceDescription = divergenceFlag
    ? `SEC EDGAR divergence — ${conditionFired.join('; ')}`
    : null

  // ── Confidence ladder ─────────────────────────────────────────────
  //  high: ≥3 hits AND ≥2 distinct form types represented AND Haiku coherent
  //  medium: ≥1 hit (Haiku soft signal acceptable)
  //  low: empty hits (handled above)
  const formTypesPresent = new Set<string>()
  if (form4Trades.length) formTypesPresent.add('form4')
  if (f13Holdings.length) formTypesPresent.add('f13')
  if (d13Filings.length) formTypesPresent.add('d13')

  let confidenceLevel: IntegrationResult['confidenceLevel']
  if (hits.length >= 3 && formTypesPresent.size >= 2 && haikuOk) {
    confidenceLevel = 'high'
  } else if (hits.length >= 1) {
    confidenceLevel = 'medium'
  } else {
    confidenceLevel = 'low'
  }

  return {
    rawContent: {
      form4Trades,
      f13Holdings,
      d13Filings,
      queryKeywords: keywords,
      windowDays: WINDOW_DAYS,
      hitCount: hits.length,
      assessment,
      haikuCostUsd: haikuCost,
    },
    haikuSummary: haikuOk
      ? `${assessment.filingsRelevant} relevant filings (${assessment.materialFilings} material); ${form4Trades.length} Form 4, ${f13Holdings.length} 13F, ${d13Filings.length} 13D/G`
      : `${hits.length} EDGAR hits; ${form4Trades.length} Form 4, ${f13Holdings.length} 13F, ${d13Filings.length} 13D/G (Haiku assessment unavailable)`,
    signalSource,
    captureDate,
    coordinates: null,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel,
  }
}
