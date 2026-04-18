/**
 * CourtListener integration — federal + state court records.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   COURTLISTENER_TOKEN (optional — raises rate limits but not required)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. No key required. With a token, rate limit is 5000 req/hour.
 * Without a token, ~100 req/hour per IP.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Searches CourtListener for federal/state cases matching entity names
 * (parties, defendants, corporations) in the 180-day window preceding
 * firstDetectedAt. Returns case metadata — docket number, court, date
 * filed, nature of suit, case name.
 *
 * This is the free, public-facing half of the federal legal data stream.
 * PACER (actual document retrieval) is gated behind admin approval
 * because it costs real money per page. CourtListener metadata is free.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const CL_TIMEOUT_MS = 20_000
const CL_SEARCH_URL = 'https://www.courtlistener.com/api/rest/v4/search/'

interface CourtListenerCase {
  docketNumber: string
  caseName: string
  court: string
  dateFiled: string
  natureOfSuit?: string
  absoluteUrl?: string
}

function buildAuthHeaders(): Record<string, string> {
  const token = process.env.COURTLISTENER_TOKEN
  return token
    ? { Authorization: `Token ${token}`, Accept: 'application/json' }
    : { Accept: 'application/json' }
}

async function searchCases(
  entities: string[],
  startDate: Date,
  endDate: Date,
): Promise<CourtListenerCase[]> {
  // Pick the 3 most distinctive entities (likely proper nouns)
  const queryEntities = entities
    .filter((e) => e.length > 3 && /^[A-Z]/.test(e))
    .slice(0, 3)
  if (queryEntities.length === 0) return []

  // Build OR-joined case name search
  const query = queryEntities.map((e) => `"${e}"`).join(' OR ')
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    q: query,
    type: 'r', // RECAP (federal court dockets) — broader than opinions
    filed_after: fmt(startDate),
    filed_before: fmt(endDate),
    order_by: 'dateFiled desc',
  })

  const url = `${CL_SEARCH_URL}?${params.toString()}`

  try {
    const res = await fetchWithTimeout(url, CL_TIMEOUT_MS, {
      headers: buildAuthHeaders(),
    })
    if (!res.ok) {
      console.warn(`[raw-signals/courtlistener] HTTP ${res.status} for query "${query}"`)
      return []
    }
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    const results = Array.isArray(data.results) ? data.results : []

    return results.slice(0, 20).map((r) => ({
      docketNumber: String(r.docketNumber ?? ''),
      caseName: String(r.caseName ?? r.caseNameShort ?? ''),
      court: String(r.court ?? r.court_id ?? ''),
      dateFiled: String(r.dateFiled ?? ''),
      natureOfSuit: r.suitNature ? String(r.suitNature) : undefined,
      absoluteUrl: r.absolute_url
        ? `https://www.courtlistener.com${String(r.absolute_url)}`
        : undefined,
    }))
  } catch (err) {
    console.warn(
      '[raw-signals/courtlistener] Query failed:',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

const HAIKU_SYSTEM_PROMPT = `You assess federal/state court filings against a news story.

Given a story and a list of court cases involving the same entities (filed in the 180 days before or after the story break), answer:
1. Are there cases that corroborate the narrative (e.g., lawsuit matching the reported event)?
2. Are there cases the story doesn't mention that are materially relevant?
3. Does the timing of filings suggest pre-story legal action the coverage missed?

Reliability note: below 2 cases, do NOT flag divergence — the data is too sparse.

Return JSON only:
{
  "caseCount": number,
  "caseSummary": "string (1 sentence)",
  "corroboratesNarrative": boolean,
  "addsMissingContext": boolean,
  "contextDescription": "string (1-2 sentences)"
}`

export const courtListenerRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx

  if (!cluster.entities || cluster.entities.length === 0) {
    return {
      rawContent: { note: 'No entities available for CourtListener query' },
      haikuSummary: 'Skipped — no entities to search.',
      signalSource: 'courtlistener',
      captureDate: new Date(),
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  // 180-day window centered on firstDetectedAt
  const endDate = new Date(cluster.firstDetectedAt.getTime() + 90 * 24 * 60 * 60 * 1000)
  const startDate = new Date(cluster.firstDetectedAt.getTime() - 90 * 24 * 60 * 60 * 1000)

  const cases = await searchCases(cluster.entities, startDate, endDate)

  if (cases.length === 0) {
    return {
      rawContent: {
        query: {
          entities: cluster.entities.slice(0, 3),
          window: { start: startDate.toISOString(), end: endDate.toISOString() },
        },
        cases: [],
        note: 'No CourtListener cases found',
      },
      haikuSummary: 'No matching federal/state court cases in 180-day window.',
      signalSource: 'courtlistener',
      captureDate: cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  const userPrompt = `Story headline: ${cluster.headline}

Story summary: ${cluster.synopsis.substring(0, 1500)}

Entities involved: ${cluster.entities.slice(0, 8).join(', ')}

Court cases found (180-day window around story break):
${cases
  .slice(0, 15)
  .map(
    (c, i) =>
      `${i + 1}. ${c.dateFiled} | ${c.court} | ${c.caseName} | docket ${c.docketNumber}${c.natureOfSuit ? ` | ${c.natureOfSuit}` : ''}`,
  )
  .join('\n')}

Assess whether these filings add context or contradict the narrative. Below 2 cases, do NOT flag divergence.`

  let assessment
  let haikuCost = 0
  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM_PROMPT,
      userPrompt,
      agentType: 'raw_signal_courtlistener',
      maxTokens: 600,
    })
    haikuCost = result.costUsd
    assessment = parseJSON<{
      caseCount: number
      caseSummary: string
      corroboratesNarrative: boolean
      addsMissingContext: boolean
      contextDescription: string
    }>(result.text)
  } catch (err) {
    console.warn(
      '[raw-signals/courtlistener] Haiku assessment failed:',
      err instanceof Error ? err.message : err,
    )
    assessment = {
      caseCount: cases.length,
      caseSummary: `${cases.length} court cases captured; Haiku assessment failed`,
      corroboratesNarrative: false,
      addsMissingContext: false,
      contextDescription: '',
    }
  }

  const belowThreshold = cases.length < 2
  const divergenceFlag = !belowThreshold && assessment.addsMissingContext
  const divergenceDescription = divergenceFlag ? assessment.contextDescription : null

  return {
    rawContent: {
      query: {
        entities: cluster.entities.slice(0, 3),
        window: { start: startDate.toISOString(), end: endDate.toISOString() },
        haikuCostUsd: haikuCost,
      },
      cases: cases.slice(0, 20),
      assessment,
    },
    haikuSummary: assessment.caseSummary || `${cases.length} court cases captured`,
    signalSource: 'courtlistener',
    captureDate: cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel: belowThreshold ? 'low' : cases.length >= 8 ? 'high' : 'medium',
  }
}
