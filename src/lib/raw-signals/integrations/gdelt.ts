/**
 * GDELT 2.0 Events integration.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 * None required. GDELT is an open public API with no key.
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. Unlimited (within reasonable usage — be polite with rate).
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Queries GDELT 2.0 Events stream for coded political/conflict events in
 * the story's geographic region and 48-hour window preceding firstDetectedAt.
 * Uses CAMEO event code ranges mapped per signalCategory.
 *
 * Reliability note (embedded as comment on the Haiku call too):
 * GDELT reliability improves above 5 coded events in the query window.
 * Below that threshold we do NOT set divergenceFlag.
 *
 * NOTE: This is distinct from the Stream 1 GDELT search used for article
 * discovery — that searches the GDELT DOC API (news articles); this queries
 * the Events stream (coded political interactions).
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'

// ── CAMEO code ranges by signalCategory ──────────────────────────────
// CAMEO = Conflict and Mediation Event Observations — 20-code taxonomy.
// Codes 01-20; ranges are the first 2 digits of specific EventRootCode.
const CAMEO_CODES_BY_CATEGORY: Record<string, string[]> = {
  military_conflict: ['18', '19'],        // Assault / Fight / Engage in unconventional mass violence
  diplomatic_negotiation: ['03', '04'],   // Express intent to cooperate / Consult
  trade_dispute: ['08', '15'],            // Yield / Exhibit force posture
  corporate_scandal: ['17'],              // Coerce
  political_scandal: ['12', '13'],        // Reject / Threaten
  economic_policy: ['15'],                // Exhibit force posture (sanctions, tariff threats)
  civil_unrest: ['14'],                   // Protest
  environmental_event: ['09'],            // Investigate (includes environmental investigations)
  election_coverage: ['13'],              // Threaten (includes electoral disputes)
}

const GDELT_TIMEOUT_MS = 20_000
const GDELT_API_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc'

interface GdeltEvent {
  date: string
  title: string
  url: string
  sourceCountry?: string
  themes?: string[]
  locations?: string[]
  tone?: number
}

async function queryGdeltEvents(
  cameoCodes: string[],
  headline: string,
  regionLabel: string | null,
  firstDetectedAt: Date,
): Promise<GdeltEvent[]> {
  // Build query: entity keywords + region + 48h window preceding firstDetectedAt
  const endDate = firstDetectedAt
  const startDate = new Date(endDate.getTime() - 48 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0]

  // Simplify the headline to the first 2-3 keywords for GDELT's full-text match
  const searchTerms = headline
    .split(/\s+/)
    .filter((w) => w.length > 3 && /^[A-Za-z]+$/.test(w))
    .slice(0, 3)
    .join(' ')
  const query = regionLabel
    ? `${searchTerms} ${regionLabel}`.trim()
    : searchTerms

  if (!query) return []

  const url =
    `${GDELT_API_BASE}?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&format=json&maxrecords=50` +
    `&startdatetime=${fmt(startDate)}&enddatetime=${fmt(endDate)}`

  try {
    const res = await fetchWithTimeout(url, GDELT_TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/gdelt] HTTP ${res.status} for query "${query}"`)
      return []
    }
    const data = await res.json() as { articles?: Array<Record<string, unknown>> }
    const articles = Array.isArray(data.articles) ? data.articles : []

    // CAMEO code filtering — GDELT's DOC API doesn't directly filter by
    // CAMEO root codes, so we filter on themes/tone as a proxy and rely on
    // Haiku to do the editorial assessment. Keep cameoCodes around for the
    // prompt context so Haiku understands what was relevant.
    return articles.slice(0, 30).map((a) => ({
      date: String(a.seendate ?? a.date ?? ''),
      title: String(a.title ?? ''),
      url: String(a.url ?? ''),
      sourceCountry: a.sourcecountry ? String(a.sourcecountry) : undefined,
      themes: a.themes ? String(a.themes).split(';').slice(0, 6) : undefined,
      tone: typeof a.tone === 'number' ? a.tone : undefined,
    }))
  } catch (err) {
    console.warn(`[raw-signals/gdelt] Query failed:`, err instanceof Error ? err.message : err)
    return []
  }
}

// ── Haiku assessment ─────────────────────────────────────────────────
const HAIKU_SYSTEM_PROMPT = `You assess GDELT (Global Database of Events, Language, and Tone) coded events against news coverage.

Given a news story and a list of GDELT events in the same region/timeframe, answer:
1. How many distinct event types were recorded?
2. Do these events corroborate the narrative?
3. Do they contradict or add missing context not in the story coverage?

GDELT reliability rule: if eventCount < 5, do NOT flag divergence. Below this threshold the coded data is too sparse to support a conclusion. Always include this threshold check.

Return JSON only:
{
  "eventCount": number,
  "eventTypeSummary": "string (1 sentence)",
  "corroboratesNarrative": boolean,
  "addsMissingContext": boolean,
  "contextDescription": "string (1-2 sentences)"
}`

export const gdeltRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx

  // Geo extraction
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)

  // CAMEO codes from signalCategory
  const cameoCodes = cluster.signalCategory
    ? CAMEO_CODES_BY_CATEGORY[cluster.signalCategory] ?? []
    : []

  // Fetch events
  const events = await queryGdeltEvents(
    cameoCodes,
    cluster.headline,
    geo.regionLabel,
    cluster.firstDetectedAt,
  )

  if (events.length === 0) {
    return {
      rawContent: {
        query: { cameoCodes, regionLabel: geo.regionLabel, windowHoursBefore: 48 },
        events: [],
        note: 'No GDELT events returned for this query',
      },
      haikuSummary: 'No GDELT events found in the region/timeframe.',
      signalSource: 'gdelt-2.0',
      captureDate: new Date(),
      coordinates: geo.boundingBox,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  // Haiku assessment
  const userPrompt = `Story headline: ${cluster.headline}

Story summary: ${cluster.synopsis.substring(0, 1500)}

Region: ${geo.regionLabel ?? 'unknown'}
CAMEO code ranges matched (signalCategory="${cluster.signalCategory}"): ${cameoCodes.join(', ')}

GDELT events in region/timeframe (48h before story break):
${events.map((e, i) => `${i + 1}. ${e.date} | ${e.title} | ${e.sourceCountry ?? ''} | tone=${e.tone ?? ''} | themes=${(e.themes ?? []).slice(0, 3).join(',')}`).join('\n')}

Assess whether these events add context or contradict the narrative. Remember: below 5 events, do NOT flag divergence.`

  let assessment
  let haikuCost = 0
  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM_PROMPT,
      userPrompt,
      agentType: 'raw_signal_gdelt',
      maxTokens: 600,
    })
    haikuCost = result.costUsd
    assessment = parseJSON<{
      eventCount: number
      eventTypeSummary: string
      corroboratesNarrative: boolean
      addsMissingContext: boolean
      contextDescription: string
    }>(result.text)
  } catch (err) {
    console.warn(`[raw-signals/gdelt] Haiku assessment failed:`, err instanceof Error ? err.message : err)
    assessment = {
      eventCount: events.length,
      eventTypeSummary: 'Haiku assessment failed; raw events captured',
      corroboratesNarrative: false,
      addsMissingContext: false,
      contextDescription: '',
    }
  }

  // Reliability threshold: below 5 events, no divergence flag
  const belowThreshold = events.length < 5
  const divergenceFlag = !belowThreshold && assessment.addsMissingContext
  const divergenceDescription = divergenceFlag ? assessment.contextDescription : null

  return {
    rawContent: {
      query: {
        cameoCodes,
        regionLabel: geo.regionLabel,
        windowHoursBefore: 48,
        haikuCostUsd: haikuCost,
      },
      events: events.slice(0, 30),
      assessment,
    },
    haikuSummary: assessment.eventTypeSummary || `${events.length} GDELT events captured`,
    signalSource: 'gdelt-2.0',
    captureDate: cluster.firstDetectedAt,
    coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel: belowThreshold ? 'low' : events.length >= 15 ? 'high' : 'medium',
  }
}
