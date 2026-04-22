/**
 * World Bank Open Data — country-level indicators.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free. No key.
 * ── What: Pulls GDP growth, inflation, trade balance, FDI for countries
 *    named as story entities. Large swings in GDP growth or trade balance
 *    that aren't referenced in the narrative are a divergence signal.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const API_BASE = 'https://api.worldbank.org/v2'
// Indicators most narrative-relevant
const INDICATORS = [
  'NY.GDP.MKTP.KD.ZG',    // GDP growth
  'FP.CPI.TOTL.ZG',        // Inflation
  'NE.TRD.GNFS.ZS',        // Trade as % of GDP
  'BX.KLT.DINV.CD.WD',     // FDI inflows (USD)
]

// Minimal country-code map for common entities — World Bank uses ISO-3
// Real implementation should resolve via a canonical country name → ISO-3 mapping.
const COUNTRY_ISO3: Record<string, string> = {
  'United States': 'USA', US: 'USA', USA: 'USA',
  China: 'CHN', Russia: 'RUS', Iran: 'IRN', Israel: 'ISR', Ukraine: 'UKR',
  Germany: 'DEU', 'United Kingdom': 'GBR', UK: 'GBR',
  India: 'IND', Japan: 'JPN', Turkey: 'TUR', Mexico: 'MEX', Brazil: 'BRA',
  'South Korea': 'KOR', 'North Korea': 'PRK',
  'Saudi Arabia': 'SAU', Egypt: 'EGY', Syria: 'SYR', Iraq: 'IRQ',
  France: 'FRA', Italy: 'ITA', Spain: 'ESP',
}

interface IndicatorRow {
  country: string
  indicator: string
  value: number | null
  year: string
}

function resolveCountries(entities: string[]): string[] {
  const iso3: string[] = []
  for (const e of entities) {
    const code = COUNTRY_ISO3[e] ?? COUNTRY_ISO3[e.toUpperCase()] ?? null
    if (code && !iso3.includes(code)) iso3.push(code)
  }
  return iso3.slice(0, 3)
}

async function fetchIndicators(iso3s: string[]): Promise<IndicatorRow[]> {
  const rows: IndicatorRow[] = []
  for (const country of iso3s) {
    for (const indicator of INDICATORS) {
      try {
        const url = `${API_BASE}/country/${country}/indicator/${indicator}?format=json&per_page=3`
        const res = await fetchWithTimeout(url, TIMEOUT_MS, { headers: { Accept: 'application/json' } })
        if (!res.ok) continue
        const data = (await res.json()) as unknown[]
        const entries = Array.isArray(data) && data.length > 1 && Array.isArray(data[1]) ? (data[1] as Array<Record<string, unknown>>) : []
        for (const e of entries.slice(0, 2)) {
          rows.push({
            country,
            indicator,
            value: typeof e.value === 'number' ? (e.value as number) : null,
            year: String(e.date ?? ''),
          })
        }
      } catch (err) {
        console.warn('[raw-signals/world-bank] fetch failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  return rows
}

const HAIKU_SYSTEM = `You assess World Bank indicators against a news story about one or more countries.
Given recent GDP growth, inflation, trade, and FDI data, return:
- materialIndicators: count of indicators showing a notable change (>2pp move in growth/inflation, or >10% change in FDI)
- indicatorsOmitted: true if a material indicator is directly relevant AND absent from the story
- description: 1-2 sentences or empty
Return JSON only:
{ "materialIndicators": 0, "indicatorsOmitted": false, "description": "" }`

export const worldBankRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const countries = resolveCountries(cluster.entities)
  if (countries.length === 0) {
    return {
      rawContent: { note: 'No known country entities' }, haikuSummary: 'Skipped — no country match',
      signalSource: 'world-bank', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const rows = await fetchIndicators(countries)
  if (rows.length === 0) {
    return {
      rawContent: { countries, rows: [] }, haikuSummary: 'No World Bank indicator data returned.',
      signalSource: 'world-bank', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { materialIndicators: 0, indicatorsOmitted: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nIndicators:\n${rows.slice(0, 20).map((r, i) => `${i + 1}. ${r.country} | ${r.indicator} | ${r.value ?? 'n/a'} | ${r.year}`).join('\n')}`,
      agentType: 'raw_signal_world_bank', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/world-bank] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { rows: rows.slice(0, 20), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.materialIndicators} material indicators across ${countries.length} countries`,
    signalSource: 'world-bank', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.indicatorsOmitted,
    divergenceDescription: assessment.indicatorsOmitted ? assessment.description : null,
    confidenceLevel: assessment.materialIndicators >= 3 ? 'medium' : 'low',
  }
}
