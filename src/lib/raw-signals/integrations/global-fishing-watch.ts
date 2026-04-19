/**
 * Global Fishing Watch — maritime_fishing.
 *
 * ── Environment Variables: GFW_API_KEY (required, free for research/academic).
 * ── Cost: Free tier.
 * ── What: Queries GFW's public API for vessel activity events (fishing,
 *    loitering, encounters, port visits) in the story's bounding box and
 *    30-day window. Flags divergence when illegal fishing / suspicious
 *    vessel behavior in a story-relevant EEZ is unreported in coverage.
 *
 * Register free key at: https://globalfishingwatch.org/our-apis/
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 20_000
const API_BASE = 'https://gateway.api.globalfishingwatch.org/v3'

interface FishingEvent {
  id: string
  type: string                 // fishing | loitering | encounter | port_visit | gap
  vesselName?: string
  vesselId?: string
  flag?: string
  start: string
  end: string
  durationHrs?: number
  lat?: number
  lon?: number
}

async function fetchEvents(bbox: BoundingBox | null, since: Date): Promise<FishingEvent[]> {
  if (!bbox) return []
  const key = process.env.GFW_API_KEY
  if (!key) {
    console.warn('[raw-signals/gfw] GFW_API_KEY missing — returning empty')
    return []
  }

  const start = new Date(since.getTime() - 30 * 24 * 60 * 60 * 1000)
  // Request body: region as GeoJSON bounding box polygon
  const body = {
    dataset: 'public-global-fishing-events:latest',
    startDate: start.toISOString().split('T')[0],
    endDate: since.toISOString().split('T')[0],
    region: {
      type: 'Polygon',
      coordinates: [[
        [bbox.swLng, bbox.swLat],
        [bbox.neLng, bbox.swLat],
        [bbox.neLng, bbox.neLat],
        [bbox.swLng, bbox.neLat],
        [bbox.swLng, bbox.swLat],
      ]],
    },
    limit: 50,
    offset: 0,
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/events`, TIMEOUT_MS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[raw-signals/gfw] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { entries?: Array<Record<string, unknown>> }
    return (data.entries ?? []).map((e) => {
      const pos = (e.position ?? {}) as { lat?: number; lon?: number }
      const vessel = (e.vessel ?? {}) as { name?: string; id?: string; flag?: string }
      const startStr = String(e.start ?? '')
      const endStr = String(e.end ?? '')
      const startT = Date.parse(startStr)
      const endT = Date.parse(endStr)
      const duration = Number.isFinite(startT) && Number.isFinite(endT) ? (endT - startT) / (60 * 60 * 1000) : undefined
      return {
        id: String(e.id ?? ''),
        type: String(e.type ?? ''),
        vesselName: vessel.name,
        vesselId: vessel.id,
        flag: vessel.flag,
        start: startStr,
        end: endStr,
        durationHrs: duration,
        lat: typeof pos.lat === 'number' ? pos.lat : undefined,
        lon: typeof pos.lon === 'number' ? pos.lon : undefined,
      }
    })
  } catch (err) {
    console.warn('[raw-signals/gfw] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess Global Fishing Watch vessel-activity events against a news story.
Given events (fishing / loitering / encounter / port_visit / gap) in the story's region and 30-day window, return:
- relevantEvents: count materially relevant to the story
- suspiciousEncounters: count of vessel-to-vessel encounters or loitering events that suggest illicit transfer
- flagProfile: string summary of flag-state distribution (e.g. "mostly China/Taiwan DWF fleet")
- narrativeGap: true if suspicious activity is relevant but unreported in coverage
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantEvents": 0, "suspiciousEncounters": 0, "flagProfile": "", "narrativeGap": false, "description": "" }`

export const globalFishingWatchRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const events = await fetchEvents(geo.boundingBox, cluster.firstDetectedAt)

  if (events.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, events: [] },
      haikuSummary: 'No GFW vessel-activity events for region/30d.',
      signalSource: 'global-fishing-watch', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantEvents: 0, suspiciousEncounters: 0, flagProfile: '', narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nGFW events (30d):\n${events.slice(0, 15).map((e, i) => `${i + 1}. ${e.type} | ${e.vesselName ?? '?'} (${e.flag ?? '?'}) | dur=${e.durationHrs?.toFixed(1) ?? '?'}h`).join('\n')}`,
      agentType: 'raw_signal_gfw', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/gfw] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.suspiciousEncounters > 0

  return {
    rawContent: { events: events.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantEvents} relevant events (${assessment.suspiciousEncounters} suspicious) ${assessment.flagProfile ? '· ' + assessment.flagProfile : ''}`.trim(),
    signalSource: 'global-fishing-watch', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.suspiciousEncounters >= 2 ? 'medium' : 'low',
  }
}
