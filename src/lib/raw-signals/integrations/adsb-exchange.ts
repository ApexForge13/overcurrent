/**
 * ADS-B Exchange (primary) + OpenSky Network (fallback) — aviation_adsb.
 *
 * ── Environment Variables:
 *     ADSBX_API_KEY       (optional; paid tiers unlock higher rate limits)
 *     OPENSKY_USERNAME    (optional; recommended — authenticated OpenSky has
 *     OPENSKY_PASSWORD     higher rate limits; anonymous access works but
 *                          is aggressively throttled)
 * ── Cost: Free tiers for both.
 * ── What: Queries ADSBX for aircraft active in the story's bounding box
 *    over the last 48h. Flags military / government / special-mission
 *    aircraft presence unmentioned by the narrative. When ADSBX returns
 *    empty or rate-limits, falls back to OpenSky for coverage continuity.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import { openSkyFetch } from './opensky'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_URL = 'https://adsbexchange.com/api/aircraft/json'

interface Aircraft {
  hex: string
  flight?: string
  regCountry?: string
  type?: string
  alt?: number
  lat?: number
  lon?: number
  military?: boolean
}

async function fetchAircraft(bbox: { swLat: number; swLng: number; neLat: number; neLng: number } | null): Promise<Aircraft[]> {
  if (!bbox) return []
  const key = process.env.ADSBX_API_KEY
  try {
    const res = await fetchWithTimeout(API_URL, TIMEOUT_MS, {
      headers: {
        Accept: 'application/json',
        ...(key ? { 'api-auth': key } : {}),
      },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/adsbx] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { aircraft?: Array<Record<string, unknown>> }
    return (data.aircraft ?? [])
      .filter((a) => {
        const lat = typeof a.lat === 'number' ? a.lat : null
        const lon = typeof a.lon === 'number' ? a.lon : null
        if (lat == null || lon == null) return false
        return lat >= bbox.swLat && lat <= bbox.neLat && lon >= bbox.swLng && lon <= bbox.neLng
      })
      .slice(0, 50)
      .map((a) => ({
        hex: String(a.hex ?? ''),
        flight: a.flight ? String(a.flight).trim() : undefined,
        regCountry: a.country ? String(a.country) : undefined,
        type: a.t ? String(a.t) : undefined,
        alt: typeof a.alt_baro === 'number' ? (a.alt_baro as number) : undefined,
        lat: a.lat as number | undefined,
        lon: a.lon as number | undefined,
        military: a.mil === 1 || a.mil === true,
      }))
  } catch (err) {
    console.warn('[raw-signals/adsbx] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess ADS-B aircraft activity against a news story.
Given aircraft in the story's region and the story, return:
- militaryCount: count of military/government aircraft
- specialMissionCount: count of aircraft with unusual flight characteristics
- narrativeGap: true if military or special-mission presence is unmentioned
- description: 1-2 sentences or empty
Return JSON only:
{ "militaryCount": 0, "specialMissionCount": 0, "narrativeGap": false, "description": "" }`

export const adsbExchangeRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  let aircraft = await fetchAircraft(geo.boundingBox)
  let source: 'adsb-exchange' | 'opensky' = 'adsb-exchange'

  // Fallback to OpenSky when ADSBX is empty (rate-limit, auth, or nothing in region)
  if (aircraft.length === 0) {
    const openSky = await openSkyFetch(geo.boundingBox)
    if (openSky.length > 0) {
      source = 'opensky'
      // Map OpenSky shape -> our Aircraft shape. Military flag unknown from
      // OpenSky (no built-in flag); rely on callsign heuristics in Haiku.
      aircraft = openSky.map((a) => ({
        hex: a.hex,
        flight: a.callsign,
        regCountry: a.originCountry,
        type: undefined,
        alt: typeof a.altMeters === 'number' ? Math.round(a.altMeters * 3.281) : undefined, // m -> ft
        lat: a.lat,
        lon: a.lon,
        military: undefined,
      }))
    }
  }

  if (aircraft.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, aircraft: [], note: 'ADSBX + OpenSky both empty' },
      haikuSummary: 'No ADS-B aircraft retrieved for region (ADSBX + OpenSky empty).',
      signalSource: source, captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { militaryCount: 0, specialMissionCount: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nAircraft:\n${aircraft.slice(0, 15).map((a, i) => `${i + 1}. ${a.flight ?? '?'} | ${a.type ?? '?'} | mil=${a.military ? 'Y' : 'N'} | alt=${a.alt ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_adsbx', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/adsbx] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = (assessment.militaryCount > 0 || assessment.specialMissionCount > 0) && assessment.narrativeGap

  return {
    rawContent: { aircraft: aircraft.slice(0, 15), source, assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.militaryCount} military + ${assessment.specialMissionCount} special-mission aircraft (via ${source})`,
    signalSource: source, captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.militaryCount >= 3 ? 'high' : assessment.militaryCount >= 1 ? 'medium' : 'low',
  }
}
