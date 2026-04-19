/**
 * SEC EDGAR — public filings (8-K, Form 4 insider trades, 13F holdings).
 *
 * ── Environment Variables ─────────────────────────────────────────────
 * SEC_EDGAR_USER_AGENT (optional; defaults to admin email)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. SEC requires a descriptive User-Agent identifying the requester.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Searches EDGAR full-text for filings mentioning cluster entities in the
 * 90-day window preceding firstDetectedAt. Flags divergence when an 8-K
 * material-event filing contradicts or adds context the narrative omits.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const FULL_TEXT_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index'
const USER_AGENT = process.env.SEC_EDGAR_USER_AGENT ?? 'Overcurrent/1.0 connermhecht13@gmail.com'
const WINDOW_DAYS = 90

interface Filing {
  accessionNumber: string
  filedAt: string
  formType: string
  displayNames: string[]
  summary?: string
}

async function searchFilings(entities: string[], since: Date): Promise<Filing[]> {
  const keywords = entities.filter((e) => e.length > 3 && /^[A-Z]/.test(e)).slice(0, 3)
  if (keywords.length === 0) return []

  const start = new Date(since.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    q: `"${keywords.join('" OR "')}"`,
    forms: '8-K,4,13F-HR,SC 13D,SC 13G,DEF 14A',
    dateRange: 'custom',
    startdt: start.toISOString().split('T')[0],
    enddt: since.toISOString().split('T')[0],
  })

  try {
    const res = await fetchWithTimeout(`${FULL_TEXT_SEARCH_URL}?${params}`, TIMEOUT_MS, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/sec-edgar] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } }
    const hits = data.hits?.hits ?? []
    return hits.slice(0, 25).map((h) => {
      const s = h._source ?? {}
      return {
        accessionNumber: String(s.adsh ?? ''),
        filedAt: String(s.file_date ?? ''),
        formType: String(s.form ?? ''),
        displayNames: Array.isArray(s.display_names) ? (s.display_names as string[]) : [],
        summary: s.xsl ? String(s.xsl).substring(0, 200) : undefined,
      }
    })
  } catch (err) {
    console.warn('[raw-signals/sec-edgar] query failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess SEC EDGAR filings against news coverage.
Given a story and filings matching cluster entities in the 90-day pre-story window, return:
- filingsRelevant: count of filings truly about the same entity/event as the story
- materialFilings: count that are 8-K material-event filings or Form 4 insider trades
- narrativeGap: true if a material filing contradicts or is omitted from the narrative
- gapDescription: 1-2 sentences or empty
Return JSON only:
{ "filingsRelevant": 0, "materialFilings": 0, "narrativeGap": false, "gapDescription": "" }`

export const secEdgarRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  if (!cluster.entities.length) {
    return {
      rawContent: { note: 'No entities' }, haikuSummary: 'Skipped — no entities',
      signalSource: 'sec-edgar', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const filings = await searchFilings(cluster.entities, cluster.firstDetectedAt)

  if (filings.length === 0) {
    return {
      rawContent: { query: { entities: cluster.entities.slice(0, 3) }, filings: [] },
      haikuSummary: 'No SEC EDGAR filings for entities in 90-day window.',
      signalSource: 'sec-edgar', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { filingsRelevant: 0, materialFilings: 0, narrativeGap: false, gapDescription: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nFilings:\n${filings.slice(0, 12).map((f, i) => `${i + 1}. ${f.formType} | ${f.filedAt} | ${f.displayNames.slice(0, 2).join('; ')}`).join('\n')}`,
      agentType: 'raw_signal_sec_edgar',
      maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/sec-edgar] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.materialFilings > 0 && assessment.narrativeGap

  return {
    rawContent: { filings: filings.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.filingsRelevant} relevant filings (${assessment.materialFilings} material)`,
    signalSource: 'sec-edgar', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.gapDescription : null,
    confidenceLevel: assessment.materialFilings >= 2 ? 'high' : assessment.filingsRelevant >= 1 ? 'medium' : 'low',
  }
}
