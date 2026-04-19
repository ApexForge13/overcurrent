/**
 * UNHCR — refugee and displacement population statistics.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Queries the UNHCR Population Data API for refugee populations,
 *    IDPs, asylum seekers linked to countries named in the story. Sharp
 *    increases unmentioned in the coverage are a divergence signal —
 *    particularly for conflict and civil-unrest narratives.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_URL = 'https://api.unhcr.org/population/v1/population/'

const COUNTRY_ISO3: Record<string, string> = {
  'United States': 'USA', Ukraine: 'UKR', Russia: 'RUS', Syria: 'SYR',
  Iran: 'IRN', Iraq: 'IRQ', 'South Sudan': 'SSD', Sudan: 'SDN',
  Venezuela: 'VEN', Myanmar: 'MMR', Afghanistan: 'AFG', Yemen: 'YEM',
  'Democratic Republic of Congo': 'COD', Ethiopia: 'ETH', Somalia: 'SOM',
  Palestine: 'PSE', Lebanon: 'LBN', Turkey: 'TUR', Bangladesh: 'BGD',
}

interface Population {
  country: string
  year: number
  refugees?: number
  idps?: number
  asylumSeekers?: number
}

function resolveCountries(entities: string[]): string[] {
  const out: string[] = []
  for (const e of entities) {
    const code = COUNTRY_ISO3[e]
    if (code && !out.includes(code)) out.push(code)
  }
  return out.slice(0, 3)
}

async function fetchPopulation(iso3: string, since: Date): Promise<Population[]> {
  try {
    const yearNow = since.getFullYear()
    const params = new URLSearchParams({
      limit: '5',
      yearFrom: String(yearNow - 1),
      yearTo: String(yearNow),
      coo: iso3,
    })
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { items?: Array<Record<string, unknown>> }
    return (data.items ?? []).map((i) => ({
      country: String(i.coo_iso ?? iso3),
      year: typeof i.year === 'number' ? (i.year as number) : Number(i.year ?? 0),
      refugees: typeof i.refugees === 'number' ? (i.refugees as number) : undefined,
      idps: typeof i.idps === 'number' ? (i.idps as number) : undefined,
      asylumSeekers: typeof i.asylum_seekers === 'number' ? (i.asylum_seekers as number) : undefined,
    }))
  } catch (err) {
    console.warn(`[raw-signals/unhcr] fetch failed for ${iso3}:`, err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess UNHCR displacement statistics against a news story.
Given YoY refugee/IDP/asylum-seeker counts for relevant countries and the story, return:
- materialChange: true if any population category moved >20% YoY
- narrativeGap: true if a material displacement change is directly relevant but unreferenced
- description: 1-2 sentences or empty
Return JSON only:
{ "materialChange": false, "narrativeGap": false, "description": "" }`

export const unhcrRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const countries = resolveCountries(cluster.entities)
  if (countries.length === 0) {
    return {
      rawContent: { note: 'No known country entities' },
      haikuSummary: 'Skipped — no country match',
      signalSource: 'unhcr', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const rows: Population[] = []
  for (const c of countries) {
    const data = await fetchPopulation(c, cluster.firstDetectedAt)
    rows.push(...data)
  }
  if (rows.length === 0) {
    return {
      rawContent: { countries, rows: [] },
      haikuSummary: 'No UNHCR data returned for story countries.',
      signalSource: 'unhcr', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { materialChange: false, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nUNHCR populations (YoY):\n${rows.slice(0, 15).map((r, i) => `${i + 1}. ${r.country} ${r.year} | refugees=${r.refugees ?? '?'} | IDPs=${r.idps ?? '?'} | asylum=${r.asylumSeekers ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_unhcr', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/unhcr] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { rows: rows.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.materialChange ? 'Material displacement change detected' : 'Displacement stable',
    signalSource: 'unhcr', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: assessment.materialChange ? 'medium' : 'low',
  }
}
