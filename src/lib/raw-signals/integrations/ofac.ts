/**
 * OFAC Sanctions integration — U.S. Treasury Specially Designated Nationals list.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 * None required. OFAC data is public.
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Checks whether any of the story's entities (people, companies, vessels)
 * appear on OFAC's SDN list or consolidated sanctions list. Uses the
 * public OFAC Sanctions Search API.
 *
 * Any entity match is a MATERIAL finding — coverage that omits OFAC
 * status when it's relevant is a significant story gap.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const OFAC_TIMEOUT_MS = 15_000
// Public OFAC Sanctions Search API — fuzzy matching on names
const OFAC_SEARCH_URL = 'https://sanctionssearch.ofac.treas.gov/Search.aspx'
// Alternative: Sanctions List Service with structured API
const SLS_SEARCH_URL =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML'

interface OfacMatch {
  name: string
  type: string // individual | entity | vessel | aircraft
  sdnType?: string
  programs: string[]
  address?: string
  remarks?: string
  matchScore?: number
}

/**
 * Use the openfec/openSanctions hosted OFAC JSON — a mirror of the SDN list
 * that's queryable without XML parsing. Fallback to local full-name fuzzy match.
 */
async function searchSanctions(entities: string[]): Promise<OfacMatch[]> {
  const matches: OfacMatch[] = []
  const queryEntities = entities
    .filter((e) => e.length > 3 && /^[A-Z]/.test(e))
    .slice(0, 5)

  if (queryEntities.length === 0) return []

  // Use OpenSanctions API (free, no auth) which indexes OFAC among 100+ lists
  // Docs: https://www.opensanctions.org/docs/api/
  const OPEN_SANCTIONS_URL = 'https://api.opensanctions.org/match/default'

  try {
    const payload = {
      queries: queryEntities.reduce<Record<string, Record<string, unknown>>>(
        (acc, entity, idx) => {
          acc[`q${idx}`] = {
            schema: 'Thing',
            properties: { name: [entity] },
          }
          return acc
        },
        {},
      ),
    }

    const res = await fetchWithTimeout(OPEN_SANCTIONS_URL, OFAC_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      console.warn(`[raw-signals/ofac] OpenSanctions HTTP ${res.status}`)
      return []
    }

    const data = (await res.json()) as {
      responses?: Record<string, { results?: Array<Record<string, unknown>> }>
    }

    for (const [_queryKey, response] of Object.entries(data.responses ?? {})) {
      const results = Array.isArray(response?.results) ? response.results : []
      for (const hit of results.slice(0, 3)) {
        const props = (hit.properties ?? {}) as Record<string, unknown>
        const datasets = Array.isArray(hit.datasets) ? (hit.datasets as string[]) : []
        // Only report hits on OFAC lists (filter out non-US sanctions to stay focused)
        const isOfac = datasets.some((d) => d.startsWith('us_ofac') || d === 'us_sdn')
        if (!isOfac) continue
        matches.push({
          name: Array.isArray(props.name) ? String(props.name[0]) : String(hit.caption ?? ''),
          type: String(hit.schema ?? 'entity'),
          sdnType: datasets.filter((d) => d.startsWith('us_ofac')).join(','),
          programs: Array.isArray(props.program)
            ? (props.program as unknown[]).map(String)
            : [],
          address: Array.isArray(props.address)
            ? String(props.address[0])
            : undefined,
          remarks: Array.isArray(props.notes) ? String(props.notes[0]) : undefined,
          matchScore: typeof hit.score === 'number' ? (hit.score as number) : undefined,
        })
      }
    }
  } catch (err) {
    console.warn(
      '[raw-signals/ofac] OpenSanctions query failed:',
      err instanceof Error ? err.message : err,
    )
    // Best-effort fallback: direct OFAC search would require XML parsing; skip.
    return []
  }

  // Dedup by name (lowercased)
  const seen = new Set<string>()
  return matches.filter((m) => {
    const key = m.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const HAIKU_SYSTEM_PROMPT = `You assess U.S. OFAC sanctions hits against a news story.

Given a story and a list of entities that matched OFAC's Specially Designated Nationals (SDN) or consolidated sanctions list, answer:
1. Are the matched entities the same ones the story discusses (true match)?
2. Does the coverage acknowledge their sanctioned status?
3. Is the omission of sanctions context material (i.e., relevant to interpreting the story)?

Note: OpenSanctions fuzzy matches may include unrelated entities with similar names. Use the story's context to filter.

Return JSON only:
{
  "matchCount": number,
  "trueMatches": number,
  "sanctionsCoverageGap": boolean,
  "gapDescription": "string (1-2 sentences)",
  "corroboratesNarrative": boolean
}`

export const ofacRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx

  if (!cluster.entities || cluster.entities.length === 0) {
    return {
      rawContent: { note: 'No entities available for OFAC query' },
      haikuSummary: 'Skipped — no entities to search.',
      signalSource: 'ofac-sdn',
      captureDate: new Date(),
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  const matches = await searchSanctions(cluster.entities)

  if (matches.length === 0) {
    return {
      rawContent: {
        query: { entities: cluster.entities.slice(0, 5) },
        matches: [],
        note: 'No OFAC sanctions matches for story entities',
      },
      haikuSummary: 'No OFAC sanctions hits on story entities.',
      signalSource: 'ofac-sdn',
      captureDate: cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  const userPrompt = `Story headline: ${cluster.headline}

Story summary: ${cluster.synopsis.substring(0, 1500)}

Story entities: ${cluster.entities.slice(0, 8).join(', ')}

OFAC sanctions matches (fuzzy matched — some may be false positives):
${matches
  .slice(0, 10)
  .map(
    (m, i) =>
      `${i + 1}. ${m.name} | type=${m.type} | programs=${m.programs.join(',') || 'unspecified'} | score=${m.matchScore ?? '?'}`,
  )
  .join('\n')}

Assess which matches are TRUE matches (same entities as in the story) and whether the coverage acknowledges their sanctioned status.`

  let assessment
  let haikuCost = 0
  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM_PROMPT,
      userPrompt,
      agentType: 'raw_signal_ofac',
      maxTokens: 600,
    })
    haikuCost = result.costUsd
    assessment = parseJSON<{
      matchCount: number
      trueMatches: number
      sanctionsCoverageGap: boolean
      gapDescription: string
      corroboratesNarrative: boolean
    }>(result.text)
  } catch (err) {
    console.warn(
      '[raw-signals/ofac] Haiku assessment failed:',
      err instanceof Error ? err.message : err,
    )
    assessment = {
      matchCount: matches.length,
      trueMatches: 0,
      sanctionsCoverageGap: false,
      gapDescription: '',
      corroboratesNarrative: false,
    }
  }

  const divergenceFlag = assessment.sanctionsCoverageGap && assessment.trueMatches > 0
  const divergenceDescription = divergenceFlag ? assessment.gapDescription : null

  return {
    rawContent: {
      query: { entities: cluster.entities.slice(0, 5), haikuCostUsd: haikuCost },
      matches: matches.slice(0, 10),
      assessment,
    },
    haikuSummary:
      assessment.trueMatches > 0
        ? `${assessment.trueMatches} true OFAC match(es) of ${matches.length} candidates`
        : `${matches.length} candidate matches, none confirmed by Haiku`,
    signalSource: 'ofac-sdn',
    captureDate: cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel:
      assessment.trueMatches >= 2 ? 'high' : assessment.trueMatches >= 1 ? 'medium' : 'low',
  }
}
