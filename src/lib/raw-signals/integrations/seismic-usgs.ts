/**
 * USGS Seismic — earthquake catalog.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Queries USGS earthquake.usgs.gov/fdsnws for events in the
 *    story's bounding box and 72-hour window. Flags divergence when a
 *    seismic event in a region without known fault lines occurred — a
 *    nuclear test, large conventional strike, or undisclosed explosion
 *    can all manifest as seismic signatures.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query'

interface Quake {
  id: string
  time: string
  place: string
  mag: number | null
  depthKm: number | null
  lat: number
  lon: number
}

async function fetchEvents(
  bbox: { swLat: number; swLng: number; neLat: number; neLng: number } | null,
  since: Date,
): Promise<Quake[]> {
  if (!bbox) return []
  const start = new Date(since.getTime() - 72 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: start.toISOString(),
    endtime: since.toISOString(),
    minlatitude: String(bbox.swLat),
    maxlatitude: String(bbox.neLat),
    minlongitude: String(bbox.swLng),
    maxlongitude: String(bbox.neLng),
    minmagnitude: '2.0',
    limit: '50',
  })
  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/geo+json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/usgs] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as {
      features?: Array<{
        id?: string
        geometry?: { coordinates?: number[] }
        properties?: Record<string, unknown>
      }>
    }
    return (data.features ?? []).map((f) => {
      const coords = f.geometry?.coordinates ?? []
      const p = f.properties ?? {}
      return {
        id: String(f.id ?? ''),
        time: typeof p.time === 'number' ? new Date(p.time as number).toISOString() : '',
        place: String(p.place ?? ''),
        mag: typeof p.mag === 'number' ? (p.mag as number) : null,
        depthKm: typeof coords[2] === 'number' ? (coords[2] as number) : null,
        lat: typeof coords[1] === 'number' ? (coords[1] as number) : 0,
        lon: typeof coords[0] === 'number' ? (coords[0] as number) : 0,
      }
    })
  } catch (err) {
    console.warn('[raw-signals/usgs] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess USGS seismic events against a news story.
Given quakes in the story's bounding box / 72h window and the story context, return:
- quakeCount: count of events
- suspectedArtificial: count of events that could plausibly be artificial (shallow depth, no known fault line, unusual for region)
- narrativeGap: true if a suspected-artificial event is directly relevant but unmentioned
- description: 1-2 sentences or empty
Return JSON only:
{ "quakeCount": 0, "suspectedArtificial": 0, "narrativeGap": false, "description": "" }`

export const seismicUsgsRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const events = await fetchEvents(geo.boundingBox, cluster.firstDetectedAt)

  if (events.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, events: [] },
      haikuSummary: 'No seismic events in region/72h window.',
      signalSource: 'usgs-seismic', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { quakeCount: events.length, suspectedArtificial: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nEvents:\n${events.slice(0, 15).map((e, i) => `${i + 1}. ${e.time} | ${e.place} | mag=${e.mag ?? '?'} | depth=${e.depthKm ?? '?'}km`).join('\n')}`,
      agentType: 'raw_signal_usgs', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/usgs] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.suspectedArtificial > 0 && assessment.narrativeGap

  return {
    rawContent: { events: events.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.quakeCount} quakes (${assessment.suspectedArtificial} suspected artificial)`,
    signalSource: 'usgs-seismic', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.suspectedArtificial >= 1 ? 'medium' : 'low',
  }
}
