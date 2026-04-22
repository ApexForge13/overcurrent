/**
 * OpenAerialMap — crowdsourced humanitarian aerial imagery.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Queries OpenAerialMap's /meta endpoint for imagery footprints
 *    intersecting the story's bounding box and captured in the 30 days
 *    before firstDetectedAt. Flags presence of recent imagery that could
 *    independently verify ground conditions described in the story.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const API_URL = 'https://api.openaerialmap.org/meta'

interface Imagery {
  id: string
  title?: string
  provider?: string
  acquisitionStart?: string
  acquisitionEnd?: string
  url?: string
}

async function fetchImagery(
  bbox: { swLat: number; swLng: number; neLat: number; neLng: number } | null,
  since: Date,
): Promise<Imagery[]> {
  if (!bbox) return []
  const start = new Date(since.getTime() - 30 * 24 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    bbox: `${bbox.swLng},${bbox.swLat},${bbox.neLng},${bbox.neLat}`,
    acquisition_from: start.toISOString(),
    acquisition_to: since.toISOString(),
    limit: '20',
  })
  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    return (data.results ?? []).map((r) => ({
      id: String(r._id ?? ''),
      title: r.title ? String(r.title) : undefined,
      provider: r.provider ? String(r.provider) : undefined,
      acquisitionStart: r.acquisition_start ? String(r.acquisition_start) : undefined,
      acquisitionEnd: r.acquisition_end ? String(r.acquisition_end) : undefined,
      url: r.properties && typeof r.properties === 'object' && (r.properties as { url?: string }).url
        ? String((r.properties as { url?: string }).url)
        : undefined,
    }))
  } catch (err) {
    console.warn('[raw-signals/oam] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess OpenAerialMap imagery footprints against a news story.
Given recent humanitarian-imagery captures in the story region, return:
- relevantImagery: count of captures clearly relevant to the event
- description: 1 sentence describing what might be independently verifiable from these images
Return JSON only:
{ "relevantImagery": 0, "description": "" }`

export const openAerialMapRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const imagery = await fetchImagery(geo.boundingBox, cluster.firstDetectedAt)

  if (imagery.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, imagery: [] },
      haikuSummary: 'No OpenAerialMap imagery in region/30d window.',
      signalSource: 'openaerialmap', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantImagery: 0, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nImagery captures:\n${imagery.slice(0, 12).map((m, i) => `${i + 1}. ${m.title ?? m.id} | ${m.provider ?? '?'} | ${m.acquisitionStart}`).join('\n')}`,
      agentType: 'raw_signal_oam', maxTokens: 300,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/oam] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { imagery: imagery.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantImagery} relevant imagery captures`,
    signalSource: 'openaerialmap', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag: false, divergenceDescription: null,
    confidenceLevel: assessment.relevantImagery >= 1 ? 'medium' : 'low',
  }
}
