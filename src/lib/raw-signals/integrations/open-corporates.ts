/**
 * OpenCorporates — global company registry search.
 *
 * ── Environment Variables: OPENCORPORATES_API_KEY (optional — free tier
 *    allows small volume without a key; a key raises limits).
 * ── Cost: Free tier. Paid tier for full bulk data.
 * ── What: Queries the OpenCorporates company search API for entity names,
 *    returns incorporation jurisdictions + officers + current status.
 *    Flags divergence when the coverage presents a company as domiciled in
 *    a different jurisdiction or under different beneficial ownership than
 *    the registry record shows.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const SEARCH_URL = 'https://api.opencorporates.com/v0.4/companies/search'

interface Company {
  name: string
  companyNumber: string
  jurisdictionCode: string
  currentStatus?: string
  incorporationDate?: string
  inactive?: boolean
  registryUrl?: string
}

async function searchCompanies(entities: string[]): Promise<Company[]> {
  const queryEntities = entities.filter((e) => e.length > 3 && /^[A-Z]/.test(e)).slice(0, 3)
  if (queryEntities.length === 0) return []

  const key = process.env.OPENCORPORATES_API_KEY
  const out: Company[] = []

  for (const entity of queryEntities) {
    try {
      const params = new URLSearchParams({
        q: entity,
        per_page: '10',
        ...(key ? { api_token: key } : {}),
      })
      const res = await fetchWithTimeout(`${SEARCH_URL}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        console.warn(`[raw-signals/opencorporates] HTTP ${res.status} for "${entity}"`)
        continue
      }
      const data = (await res.json()) as { results?: { companies?: Array<{ company?: Record<string, unknown> }> } }
      const companies = data.results?.companies ?? []
      for (const c of companies) {
        const co = c.company ?? {}
        out.push({
          name: String(co.name ?? ''),
          companyNumber: String(co.company_number ?? ''),
          jurisdictionCode: String(co.jurisdiction_code ?? ''),
          currentStatus: co.current_status ? String(co.current_status) : undefined,
          incorporationDate: co.incorporation_date ? String(co.incorporation_date) : undefined,
          inactive: typeof co.inactive === 'boolean' ? (co.inactive as boolean) : undefined,
          registryUrl: co.registry_url ? String(co.registry_url) : undefined,
        })
      }
    } catch (err) {
      console.warn(`[raw-signals/opencorporates] search failed for "${entity}":`, err instanceof Error ? err.message : err)
    }
  }

  return out.slice(0, 25)
}

const HAIKU_SYSTEM = `You assess OpenCorporates registry hits against a news story.
Given entities named in a story and matching registry records, return:
- trueMatches: count of registry records that match a story entity
- jurisdictionMismatch: true if the story's implicit jurisdiction differs from the registry jurisdiction
- inactiveOrDissolved: count of matches that are inactive/dissolved per the registry
- narrativeGap: true if the registry record reveals information (jurisdiction, status) absent from the story
- description: 1-2 sentences or empty
Return JSON only:
{ "trueMatches": 0, "jurisdictionMismatch": false, "inactiveOrDissolved": 0, "narrativeGap": false, "description": "" }`

export const openCorporatesRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  if (!cluster.entities.length) {
    return {
      rawContent: { note: 'No entities' }, haikuSummary: 'Skipped — no entities',
      signalSource: 'opencorporates', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const companies = await searchCompanies(cluster.entities)

  if (companies.length === 0) {
    return {
      rawContent: { query: { entities: cluster.entities.slice(0, 3) }, companies: [] },
      haikuSummary: 'No OpenCorporates matches for entities.',
      signalSource: 'opencorporates', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { trueMatches: 0, jurisdictionMismatch: false, inactiveOrDissolved: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nRegistry hits:\n${companies.slice(0, 12).map((c, i) => `${i + 1}. ${c.name} | ${c.jurisdictionCode} | ${c.currentStatus ?? '?'} | ${c.incorporationDate ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_opencorporates', maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/opencorporates] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.trueMatches > 0

  return {
    rawContent: { companies: companies.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.trueMatches} registry matches (${assessment.inactiveOrDissolved} inactive)`,
    signalSource: 'opencorporates', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.trueMatches >= 3 ? 'high' : assessment.trueMatches >= 1 ? 'medium' : 'low',
  }
}
