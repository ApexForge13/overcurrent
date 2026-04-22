/**
 * OpenOwnership — global beneficial ownership register aggregator.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Queries register.openownership.org JSON API for beneficial-owner
 *    entries matching cluster entities. A hit on a company with a beneficial
 *    owner not mentioned in the narrative is a coverage gap — particularly
 *    for stories involving opaque ownership structures.
 *
 * Note: The live API has limited coverage (BODS schema, UK/some jurisdictions).
 * Full global data requires Phase 10 backfill. This integration is a best-
 * effort live lookup.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
// OpenOwnership search page emits a JSON API at /entities.json
const SEARCH_URL = 'https://register.openownership.org/entities.json'

interface Entity {
  id: string
  name: string
  type?: string
  jurisdiction?: string
  ownersCount?: number
  openCorporatesUrl?: string
}

async function searchEntities(entities: string[]): Promise<Entity[]> {
  const queryEntities = entities.filter((e) => e.length > 3 && /^[A-Z]/.test(e)).slice(0, 3)
  if (queryEntities.length === 0) return []

  const out: Entity[] = []
  for (const entity of queryEntities) {
    try {
      const params = new URLSearchParams({ q: entity, per_page: '10' })
      const res = await fetchWithTimeout(`${SEARCH_URL}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        console.warn(`[raw-signals/openownership] HTTP ${res.status}`)
        continue
      }
      const data = (await res.json()) as { entities?: Array<Record<string, unknown>> }
      for (const e of data.entities ?? []) {
        out.push({
          id: String(e.id ?? ''),
          name: String(e.name ?? ''),
          type: e.type ? String(e.type) : undefined,
          jurisdiction: e.jurisdiction_code ? String(e.jurisdiction_code) : undefined,
          ownersCount: typeof e.owners_count === 'number' ? (e.owners_count as number) : undefined,
          openCorporatesUrl: e.open_corporates_url ? String(e.open_corporates_url) : undefined,
        })
      }
    } catch (err) {
      console.warn(`[raw-signals/openownership] search failed for "${entity}":`, err instanceof Error ? err.message : err)
    }
  }
  return out.slice(0, 25)
}

const HAIKU_SYSTEM = `You assess OpenOwnership register hits against a news story.
Given entities in a story and matching register records with beneficial-owner counts, return:
- trueMatches: count of register records matching story entities
- unnamedOwners: total owners count across true matches (indicates hidden structure)
- narrativeGap: true if the ownership depth is material and the story doesn't mention it
- description: 1-2 sentences or empty
Return JSON only:
{ "trueMatches": 0, "unnamedOwners": 0, "narrativeGap": false, "description": "" }`

export const openOwnershipRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  if (!cluster.entities.length) {
    return {
      rawContent: { note: 'No entities' }, haikuSummary: 'Skipped — no entities',
      signalSource: 'openownership', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const entities = await searchEntities(cluster.entities)

  if (entities.length === 0) {
    return {
      rawContent: { query: { entities: cluster.entities.slice(0, 3) }, results: [] },
      haikuSummary: 'No OpenOwnership matches.',
      signalSource: 'openownership', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { trueMatches: 0, unnamedOwners: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nOpenOwnership records:\n${entities.slice(0, 12).map((e, i) => `${i + 1}. ${e.name} | ${e.jurisdiction ?? '?'} | owners=${e.ownersCount ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_openownership', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/openownership] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.trueMatches > 0

  return {
    rawContent: { entities: entities.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.trueMatches} register matches (${assessment.unnamedOwners} total owners recorded)`,
    signalSource: 'openownership', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.trueMatches >= 2 ? 'medium' : 'low',
  }
}
