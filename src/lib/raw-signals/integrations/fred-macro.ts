/**
 * FRED — St. Louis Fed macroeconomic data.
 *
 * ── Environment Variables: FRED_API_KEY (required, free registration).
 * ── Cost: Free.
 * ── What: Pulls the latest value + 90-day change for a handful of
 *    market-moving US macro series. Flags divergence when the narrative
 *    frames macro conditions in a way the data directly contradicts.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const SERIES = [
  'FEDFUNDS',      // Fed funds rate
  'CPIAUCSL',      // CPI
  'GDP',           // US GDP
  'DCOILWTICO',    // WTI crude
  'DGS10',         // 10-year Treasury
  'UNRATE',        // Unemployment rate
] as const

interface Observation {
  series: string
  date: string
  value: number | null
}

async function fetchSeries(since: Date): Promise<Observation[]> {
  const key = process.env.FRED_API_KEY
  if (!key) {
    console.warn('[raw-signals/fred] FRED_API_KEY missing — skipping')
    return []
  }
  const start = new Date(since.getTime() - 90 * 24 * 60 * 60 * 1000)
  const out: Observation[] = []
  for (const series of SERIES) {
    try {
      const params = new URLSearchParams({
        series_id: series,
        api_key: key,
        file_type: 'json',
        observation_start: start.toISOString().split('T')[0],
        observation_end: since.toISOString().split('T')[0],
        sort_order: 'desc',
        limit: '10',
      })
      const res = await fetchWithTimeout(`${API_BASE}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue
      const data = (await res.json()) as { observations?: Array<{ date?: string; value?: string }> }
      for (const o of (data.observations ?? []).slice(0, 3)) {
        const v = o.value ? parseFloat(o.value) : NaN
        out.push({
          series,
          date: String(o.date ?? ''),
          value: Number.isFinite(v) ? v : null,
        })
      }
    } catch (err) {
      console.warn(`[raw-signals/fred] ${series} fetch failed:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

const HAIKU_SYSTEM = `You assess FRED macro data against a news story.
Given US macro series (Fed funds, CPI, GDP, oil, 10-year yield, unemployment) and a story,
return:
- macroDirectionMatch: true if the story's framing of macro conditions aligns with the data
- narrativeGap: true if the data contradicts or undermines the story's framing
- description: 1-2 sentences or empty
Return JSON only:
{ "macroDirectionMatch": true, "narrativeGap": false, "description": "" }`

export const fredMacroRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const observations = await fetchSeries(cluster.firstDetectedAt)
  if (observations.length === 0) {
    return {
      rawContent: { note: 'No observations (missing key or fetch failed)' },
      haikuSummary: 'Skipped — no FRED data available',
      signalSource: 'fred-macro', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { macroDirectionMatch: true, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nFRED series (90d window):\n${observations.slice(0, 20).map((o, i) => `${i + 1}. ${o.series} | ${o.date} | ${o.value ?? 'n/a'}`).join('\n')}`,
      agentType: 'raw_signal_fred', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/fred] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { observations: observations.slice(0, 20), assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.narrativeGap ? `Macro data contradicts story framing` : `Macro data consistent with narrative`,
    signalSource: 'fred-macro', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: 'low' as const,
  }
}
