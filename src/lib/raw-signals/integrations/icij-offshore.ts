/**
 * ICIJ Offshore Leaks — Panama/Paradise/Pandora papers public search.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Queries the ICIJ public Offshore Leaks search UI via its JSON
 *    endpoint for entities (people or companies) matching the story.
 *    A hit does not prove wrongdoing — but a hit on a named entity that
 *    the narrative frames as a legitimate actor IS a material gap.
 *
 * Note: ICIJ publishes the leaks as a structured dataset (offshoreleaks.icij.org).
 * The search page issues a JSON request to /search_results — we use that
 * same endpoint. A more robust path is a local download of the full CSV/DB
 * (Phase 10 backfill); this integration is best-effort for live queries.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const SEARCH_URL = 'https://offshoreleaks.icij.org/search'

interface Hit {
  name: string
  type?: string
  jurisdiction?: string
  linkedEntities?: string[]
  source?: string // which leak (Panama Papers, Paradise, Pandora, Offshore Leaks)
}

async function searchLeaks(entities: string[]): Promise<Hit[]> {
  const queryEntities = entities.filter((e) => e.length > 3 && /^[A-Z]/.test(e)).slice(0, 3)
  if (queryEntities.length === 0) return []

  const out: Hit[] = []
  for (const entity of queryEntities) {
    try {
      const params = new URLSearchParams({ q: entity, c: '', j: '', d: '' })
      const res = await fetchWithTimeout(`${SEARCH_URL}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      })
      if (!res.ok) continue
      const html = await res.text()
      // Parse the result table — ICIJ renders results in <tr class="search-result">
      const rowRe = /<tr[^>]*class="[^"]*search-result[^"]*"[^>]*>([\s\S]*?)<\/tr>/g
      let m: RegExpExecArray | null
      while ((m = rowRe.exec(html)) !== null) {
        const row = m[1]
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim())
        if (cells.length >= 3) {
          out.push({
            name: cells[0].substring(0, 200),
            type: cells[1]?.substring(0, 80),
            jurisdiction: cells[2]?.substring(0, 80),
            source: cells[3]?.substring(0, 80),
          })
        }
      }
    } catch (err) {
      console.warn(`[raw-signals/icij] search failed for "${entity}":`, err instanceof Error ? err.message : err)
    }
  }
  // Dedup by lowercase name
  const seen = new Set<string>()
  return out.filter((h) => {
    const k = h.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 20)
}

const HAIKU_SYSTEM = `You assess ICIJ Offshore Leaks hits against a news story.
Given a story and candidate hits (people/entities appearing in the Panama/Paradise/Pandora/Offshore Leaks),
filter for true matches and return:
- trueMatches: count of hits that ARE the same entity the story discusses
- storyAcknowledgesOffshoreTie: true if the story mentions offshore/shell/tax-haven context already
- narrativeGap: true if a true match exists AND the story frames the entity without acknowledging the offshore tie
- description: 1-2 sentences or empty
Return JSON only:
{ "trueMatches": 0, "storyAcknowledgesOffshoreTie": false, "narrativeGap": false, "description": "" }`

export const icijOffshoreRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  if (!cluster.entities.length) {
    return {
      rawContent: { note: 'No entities' }, haikuSummary: 'Skipped — no entities',
      signalSource: 'icij-offshore', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const hits = await searchLeaks(cluster.entities)

  if (hits.length === 0) {
    return {
      rawContent: { query: { entities: cluster.entities.slice(0, 3) }, hits: [] },
      haikuSummary: 'No ICIJ Offshore Leaks hits for story entities.',
      signalSource: 'icij-offshore', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { trueMatches: 0, storyAcknowledgesOffshoreTie: false, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nICIJ hits:\n${hits.slice(0, 10).map((h, i) => `${i + 1}. ${h.name} | ${h.type ?? '?'} | ${h.jurisdiction ?? '?'} | ${h.source ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_icij', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/icij] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.trueMatches > 0 && assessment.narrativeGap

  return {
    rawContent: { hits: hits.slice(0, 10), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.trueMatches} true offshore-leaks matches of ${hits.length} candidates`,
    signalSource: 'icij-offshore', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.trueMatches >= 2 ? 'high' : assessment.trueMatches >= 1 ? 'medium' : 'low',
  }
}
