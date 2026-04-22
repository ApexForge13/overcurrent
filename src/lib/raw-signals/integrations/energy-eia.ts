/**
 * EIA — US Energy Information Administration.
 *
 * ── Environment Variables: EIA_API_KEY (required, free registration).
 * ── Cost: Free.
 * ── What: Pulls latest datapoints for oil production, natural gas, crude
 *    stocks, and refinery utilization. Useful when stories frame supply
 *    disruptions — divergence fires when the narrative asserts a shortage/
 *    glut that the data doesn't support.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_BASE = 'https://api.eia.gov/v2'
const SERIES = [
  { route: 'petroleum/crd/crpdn/data', id: 'WCRFPUS2', label: 'US crude production kbbl/d' },
  { route: 'natural-gas/prod/sum/data', id: 'N9070US2', label: 'US dry gas production Bcf/d' },
  { route: 'petroleum/stoc/wstk/data', id: 'WCESTUS1', label: 'US crude stocks kbbl' },
]

interface Row {
  series: string
  label: string
  period: string
  value: number | null
}

async function fetchSeries(): Promise<Row[]> {
  const key = process.env.EIA_API_KEY
  if (!key) {
    console.warn('[raw-signals/eia] EIA_API_KEY missing — skipping')
    return []
  }
  const out: Row[] = []
  for (const s of SERIES) {
    try {
      const params = new URLSearchParams({
        api_key: key,
        'data[0]': 'value',
        'facets[series][]': s.id,
        'sort[0][column]': 'period',
        'sort[0][direction]': 'desc',
        'length': '5',
      })
      const res = await fetchWithTimeout(`${API_BASE}/${s.route}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue
      const data = (await res.json()) as { response?: { data?: Array<{ period?: string; value?: number | string }> } }
      for (const d of (data.response?.data ?? []).slice(0, 3)) {
        const v = typeof d.value === 'number' ? d.value : d.value ? parseFloat(d.value) : NaN
        out.push({
          series: s.id,
          label: s.label,
          period: String(d.period ?? ''),
          value: Number.isFinite(v) ? v : null,
        })
      }
    } catch (err) {
      console.warn(`[raw-signals/eia] ${s.id} fetch failed:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

const HAIKU_SYSTEM = `You assess US energy data (EIA) against a news story framing supply or price shifts.
Given EIA crude/gas production + stocks and a story, return:
- materialMove: true if any indicator shows an unusual shift in the latest periods
- narrativeGap: true if the story frames the energy picture in a way the data contradicts
- description: 1-2 sentences or empty
Return JSON only:
{ "materialMove": false, "narrativeGap": false, "description": "" }`

export const eiaEnergyRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const rows = await fetchSeries()
  if (rows.length === 0) {
    return {
      rawContent: { note: 'No EIA data (missing key or fetch failed)' },
      haikuSummary: 'Skipped — no EIA data',
      signalSource: 'eia-energy', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { materialMove: false, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEIA series:\n${rows.slice(0, 12).map((r, i) => `${i + 1}. ${r.label} | ${r.period} | ${r.value ?? 'n/a'}`).join('\n')}`,
      agentType: 'raw_signal_eia', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/eia] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { rows: rows.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.materialMove ? 'Material EIA data move detected' : 'EIA data within normal range',
    signalSource: 'eia-energy', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: assessment.materialMove ? 'medium' : 'low',
  }
}
