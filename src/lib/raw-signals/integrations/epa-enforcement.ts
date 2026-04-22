/**
 * EPA ECHO — enforcement + compliance data.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Queries EPA's ECHO REST API for facility-level violations +
 *    enforcement actions near the story's bounding box or tied to cluster
 *    entities. Flags divergence when the story's framing of an environmental
 *    event omits the violator/facility's enforcement history.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
// ECHO REST service — facility search by company name OR bounding box
const ECHO_URL = 'https://echodata.epa.gov/echo/cwa_rest_services.get_facilities'

interface Facility {
  name: string
  city?: string
  state?: string
  complianceStatus?: string
  lastInspection?: string
  currentSNC?: boolean  // Significant Non-Compliance
}

async function searchFacilities(entities: string[]): Promise<Facility[]> {
  const queryEntities = entities.filter((e) => e.length > 3 && /^[A-Z]/.test(e)).slice(0, 3)
  if (queryEntities.length === 0) return []

  const out: Facility[] = []
  for (const entity of queryEntities) {
    try {
      const params = new URLSearchParams({
        output: 'JSON',
        p_fn: entity,
        responseset: '3',
      })
      const res = await fetchWithTimeout(`${ECHO_URL}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue
      const data = (await res.json()) as { Results?: { Facilities?: Array<Record<string, unknown>> } }
      for (const f of (data.Results?.Facilities ?? []).slice(0, 10)) {
        out.push({
          name: String(f.FacName ?? ''),
          city: f.FacCity ? String(f.FacCity) : undefined,
          state: f.FacState ? String(f.FacState) : undefined,
          complianceStatus: f.CurrVioFlag ? String(f.CurrVioFlag) : undefined,
          lastInspection: f.LastInspection ? String(f.LastInspection) : undefined,
          currentSNC: f.CurrSncFlag === 'Y',
        })
      }
    } catch (err) {
      console.warn('[raw-signals/epa] search failed:', err instanceof Error ? err.message : err)
    }
  }
  return out.slice(0, 20)
}

const HAIKU_SYSTEM = `You assess EPA enforcement records against a news story about environmental impact.
Given a story and EPA facility compliance records, return:
- relevantFacilities: count of facilities matching story entities
- violatorsInSNC: count in Significant Non-Compliance status
- narrativeGap: true if a facility in SNC is directly relevant and not referenced
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantFacilities": 0, "violatorsInSNC": 0, "narrativeGap": false, "description": "" }`

export const epaEnforcementRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const facilities = await searchFacilities(cluster.entities)

  if (facilities.length === 0) {
    return {
      rawContent: { note: 'No EPA matches', entities: cluster.entities.slice(0, 3) },
      haikuSummary: 'No EPA ECHO facility matches.',
      signalSource: 'epa-echo', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantFacilities: 0, violatorsInSNC: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEPA facilities:\n${facilities.slice(0, 12).map((f, i) => `${i + 1}. ${f.name} | ${f.city ?? '?'}, ${f.state ?? '?'} | SNC=${f.currentSNC ? 'Y' : 'N'} | lastInspect=${f.lastInspection ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_epa', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/epa] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.violatorsInSNC > 0

  return {
    rawContent: { facilities: facilities.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantFacilities} EPA facilities (${assessment.violatorsInSNC} in SNC)`,
    signalSource: 'epa-echo', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.violatorsInSNC >= 2 ? 'medium' : 'low',
  }
}
