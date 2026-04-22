/**
 * SEC EDGAR — public filings (Form 4 insider trades, 13F institutional
 * holdings, 13D/G activist stakes, plus 8-K / DEF 14A for narrative context).
 *
 * Phase 1c.2a: HTTP + parse moved to src/lib/raw-signals/clients/sec-edgar-client.ts
 * so the trigger-pipeline code (T-GT1/T-GT2/T-GT3) can share the same
 * primitive without inheriting the cluster-context Haiku assessment.
 *
 * This adapter is the legacy cluster-scoped path — it layers Haiku
 * materiality assessment, divergence classification, and confidence
 * laddering on top of the raw filings.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   SEC_EDGAR_USER_AGENT (recommended; defaults to admin email)
 *
 * ── Error routing (canonical error-shape) ─────────────────────────────
 * Every failure path writes a RawSignalLayer row via safeErrorRow with
 * confidenceLevel='unavailable' and a RawSignalError discriminated-union
 * literal — see sec-edgar-client.ts for the full outcome table. Client
 * outcomes are translated to the RawSignalError canonical shape below.
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
import type { IntegrationResult, IntegrationRunner } from '../runner'
import { safeErrorRow, safeStringify, ERROR_VERSION } from '../error-shape'
import {
  searchByEntity,
  bucketHits,
  type SecFetchOutcome,
} from '../clients/sec-edgar-client'

const WINDOW_DAYS = 90
const DIVERGENCE_WINDOW_DAYS = 30
const FORM4_DIVERGENCE_COUNT = 3
const MAX_HITS = 25
const LEGACY_FORMS = ['8-K', '4', '13F-HR', 'SC 13D', 'SC 13G', 'DEF 14A']

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

  // ── Upstream fetch (delegated to client) ───────────────────────────
  let outcome: SecFetchOutcome
  try {
    outcome = await searchByEntity({
      entities: keywords,
      since: ctx.cluster.firstDetectedAt,
      windowDays: WINDOW_DAYS,
      forms: LEGACY_FORMS,
      maxHits: MAX_HITS,
    })
  } catch (err) {
    // Client catches its own errors; anything escaping here is
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
          timeoutMs: 20_000,
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
