/**
 * UN Comtrade — bilateral trade flows.
 *
 * ── Environment Variables: COMTRADE_API_KEY (required, free registration).
 * ── Cost: Free tier, rate-limited.
 * ── What: Pulls 12-month import/export totals between pairs of countries
 *    named in the story. Divergence: a trade dispute story where the
 *    actual bilateral flows contradict the framing of escalation or collapse.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 25_000
const API_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS'

// Reporter country codes (M49) — mirror of the world-bank ISO mapping.
const COUNTRY_M49: Record<string, string> = {
  'United States': '842', US: '842', USA: '842',
  China: '156', Russia: '643', Iran: '364', Israel: '376', Ukraine: '804',
  Germany: '276', 'United Kingdom': '826', UK: '826',
  India: '356', Japan: '392', Turkey: '792', Mexico: '484', Brazil: '076',
}

interface Row {
  reporter: string
  partner: string
  year: number
  tradeValueUSD?: number
  flow?: string // imports | exports
}

function resolveCodes(entities: string[]): string[] {
  const out: string[] = []
  for (const e of entities) {
    const code = COUNTRY_M49[e]
    if (code && !out.includes(code)) out.push(code)
  }
  return out.slice(0, 2)
}

async function fetchFlows(reporter: string, partner: string, since: Date): Promise<Row[]> {
  const key = process.env.COMTRADE_API_KEY
  if (!key) {
    console.warn('[raw-signals/un-comtrade] COMTRADE_API_KEY missing — skipping')
    return []
  }
  const yearNow = since.getFullYear()
  const params = new URLSearchParams({
    reporterCode: reporter,
    partnerCode: partner,
    period: `${yearNow - 1},${yearNow}`,
    flowCode: 'M,X',
    cmdCode: 'TOTAL',
    typeCode: 'C',
    freqCode: 'A',
    clCode: 'HS',
    subscription_key: key,
  })
  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/un-comtrade] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).slice(0, 20).map((r) => ({
      reporter: String(r.reporterDesc ?? reporter),
      partner: String(r.partnerDesc ?? partner),
      year: Number(r.refYear ?? yearNow),
      tradeValueUSD: typeof r.primaryValue === 'number' ? (r.primaryValue as number) : undefined,
      flow: String(r.flowDesc ?? ''),
    }))
  } catch (err) {
    console.warn('[raw-signals/un-comtrade] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess UN Comtrade bilateral trade flows against a news story.
Given a story and YoY trade data between two countries, return:
- flowChangePercent: approximate YoY change (signed) in combined trade value (0 if single-year)
- narrativeGap: true if the data diverges from the story's framing (e.g., story claims "trade collapsed" but data shows stable flow)
- description: 1-2 sentences or empty
Return JSON only:
{ "flowChangePercent": 0, "narrativeGap": false, "description": "" }`

export const unComtradeRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const codes = resolveCodes(cluster.entities)
  if (codes.length < 2) {
    return {
      rawContent: { note: 'Need two country entities for bilateral query', countries: cluster.entities.slice(0, 6) },
      haikuSummary: 'Skipped — need two recognized countries for bilateral flow',
      signalSource: 'un-comtrade', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const rows = await fetchFlows(codes[0], codes[1], cluster.firstDetectedAt)
  if (rows.length === 0) {
    return {
      rawContent: { codes, rows: [] }, haikuSummary: 'No UN Comtrade rows returned.',
      signalSource: 'un-comtrade', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { flowChangePercent: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nTrade flows:\n${rows.slice(0, 12).map((r, i) => `${i + 1}. ${r.reporter} → ${r.partner} | ${r.flow} | ${r.year} | $${r.tradeValueUSD?.toLocaleString() ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_un_comtrade', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/un-comtrade] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { rows: rows.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `Bilateral flow YoY change: ${assessment.flowChangePercent}%`,
    signalSource: 'un-comtrade', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: Math.abs(assessment.flowChangePercent) >= 20 ? 'medium' : 'low',
  }
}
