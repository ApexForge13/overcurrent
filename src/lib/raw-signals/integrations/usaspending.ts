/**
 * USASpending.gov — federal contracts + grants.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 * None required.
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. No rate limit published; be polite.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * POSTs to api.usaspending.gov/api/v2/search/spending_by_award for contracts
 * touching any cluster entity in the 180-day window preceding firstDetectedAt.
 * Flags divergence when the story frames an entity (agency or contractor)
 * in a way that is contradicted or omitted by the actual spending record.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'
const WINDOW_DAYS = 180

interface Award {
  awardId: string
  awardType?: string
  recipient?: string
  agency?: string
  amount?: number
  startDate?: string
  endDate?: string
  description?: string
}

async function searchAwards(entities: string[], since: Date): Promise<Award[]> {
  const keywords = entities.filter((e) => e.length > 3).slice(0, 4)
  if (keywords.length === 0) return []

  const start = new Date(since.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const body = {
    filters: {
      keywords,
      time_period: [
        { start_date: start.toISOString().split('T')[0], end_date: since.toISOString().split('T')[0] },
      ],
      award_type_codes: ['A', 'B', 'C', 'D', '02', '03', '04', '05'], // contracts + grants
    },
    fields: [
      'Award ID', 'Recipient Name', 'Awarding Agency', 'Award Amount',
      'Start Date', 'End Date', 'Description', 'Award Type',
    ],
    page: 1,
    limit: 25,
    sort: 'Award Amount',
    order: 'desc',
  }

  try {
    const res = await fetchWithTimeout(SEARCH_URL, TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[raw-signals/usaspending] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    return (data.results ?? []).map((r) => ({
      awardId: String(r['Award ID'] ?? r.generated_internal_id ?? ''),
      awardType: r['Award Type'] ? String(r['Award Type']) : undefined,
      recipient: r['Recipient Name'] ? String(r['Recipient Name']) : undefined,
      agency: r['Awarding Agency'] ? String(r['Awarding Agency']) : undefined,
      amount: typeof r['Award Amount'] === 'number' ? (r['Award Amount'] as number) : undefined,
      startDate: r['Start Date'] ? String(r['Start Date']) : undefined,
      endDate: r['End Date'] ? String(r['End Date']) : undefined,
      description: r.Description ? String(r.Description) : undefined,
    }))
  } catch (err) {
    console.warn('[raw-signals/usaspending] query failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess US federal contracts/grants against news coverage.
Given a story and awards matching the story's entities in the 180-day pre-story window, return:
- awardsRelevant: count that ARE genuinely about the same entity/context
- totalAmountUsd: summed award amount for relevant awards
- narrativeGap: true if the story frames the entity in a way contradicted/omitted by the award record
- gapDescription: 1-2 sentences describing the gap (empty string if none)
Return JSON only:
{ "awardsRelevant": 0, "totalAmountUsd": 0, "narrativeGap": false, "gapDescription": "" }`

export const usaSpendingRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  if (!cluster.entities.length) {
    return {
      rawContent: { note: 'No entities — skipped' },
      haikuSummary: 'Skipped — no entities',
      signalSource: 'usaspending-gov',
      captureDate: new Date(),
      coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const awards = await searchAwards(cluster.entities, cluster.firstDetectedAt)

  if (awards.length === 0) {
    return {
      rawContent: { query: { entities: cluster.entities.slice(0, 4) }, awards: [] },
      haikuSummary: 'No USASpending awards for story entities in 180-day window.',
      signalSource: 'usaspending-gov',
      captureDate: cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { awardsRelevant: 0, totalAmountUsd: 0, narrativeGap: false, gapDescription: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nAwards:\n${awards.slice(0, 15).map((a, i) => `${i + 1}. ${a.recipient} ← ${a.agency} | $${a.amount?.toLocaleString() ?? '?'} | ${a.startDate} | ${a.description?.substring(0, 120) ?? ''}`).join('\n')}`,
      agentType: 'raw_signal_usaspending',
      maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/usaspending] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const belowThreshold = assessment.awardsRelevant < 3
  const divergenceFlag = !belowThreshold && assessment.narrativeGap

  return {
    rawContent: { awards: awards.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.awardsRelevant > 0
      ? `${assessment.awardsRelevant} relevant awards totaling $${assessment.totalAmountUsd.toLocaleString()}`
      : `${awards.length} matches, none confirmed relevant by Haiku`,
    signalSource: 'usaspending-gov',
    captureDate: cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.gapDescription : null,
    confidenceLevel: assessment.awardsRelevant >= 10 ? 'high' : assessment.awardsRelevant >= 3 ? 'medium' : 'low',
  }
}
