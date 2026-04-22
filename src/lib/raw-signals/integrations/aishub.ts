/**
 * AIS Hub — maritime_ais PRIMARY provider.
 *
 * ── Environment Variables: AISHUB_USERNAME (required, free account).
 * ── Cost: Free tier. Register at aishub.net — username is the API key.
 * ── What: Queries vessel positions in the story's bounding box via AIS
 *    Hub's public ws.php endpoint. AIS Hub's free tier supports bbox-scoped
 *    queries at reasonable rate limits, which makes it the viable primary
 *    maritime_ais source at current stage. VesselFinder and MarineTraffic/
 *    Kpler are deferred as paid upgrade paths — see their header files.
 *
 *    Classifies AIS ship type codes into labels (tanker / cargo / military
 *    /fishing / passenger). Haiku assesses whether vessel positioning
 *    contradicts or adds material context the narrative omits (e.g.
 *    tankers still transiting a "closed" strait).
 *
 *    AIS Hub response shape: an array of [metadataObj, vesselsArray].
 *    First element is a metadata object (ERROR, USERNAME, RECORDS count,
 *    LATEST timestamp). Second element is the array of vessel position
 *    objects. Structure is parsed defensively below.
 *
 * Register free account at: https://www.aishub.net/user-signup
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 15_000
const API_URL = 'https://data.aishub.net/ws.php'

export interface AisHubVessel {
  mmsi: string
  name?: string
  callsign?: string
  imo?: string
  type?: string
  typeLabel?: string
  lat: number
  lon: number
  speedKn?: number     // SOG (speed over ground) in knots
  courseDeg?: number   // COG (course over ground) in degrees
  heading?: number
  navstat?: number     // navigational status code
  timestamp?: string   // position timestamp (TIME field, unix seconds)
  source: 'aishub'
}

function classifyShipType(type: number): string {
  if (type >= 80 && type <= 89) return 'tanker'
  if (type >= 70 && type <= 79) return 'cargo'
  if (type === 35) return 'military'
  if (type >= 30 && type <= 39) return 'fishing_or_special'
  if (type >= 60 && type <= 69) return 'passenger'
  if (type === 53) return 'port_tender'
  return 'other'
}

/**
 * Fetch vessel positions in a bounding box via AIS Hub. Returns [] on
 * missing credentials or fetch failure (never throws).
 */
async function aisHubFetch(bbox: BoundingBox | null): Promise<AisHubVessel[]> {
  if (!bbox) return []
  const username = process.env.AISHUB_USERNAME
  if (!username) {
    console.warn('[raw-signals/aishub] AISHUB_USERNAME missing — returning empty')
    return []
  }

  const params = new URLSearchParams({
    username,
    format: '1',       // JSON
    output: 'json',
    compress: '0',
    latmin: String(bbox.swLat),
    latmax: String(bbox.neLat),
    lonmin: String(bbox.swLng),
    lonmax: String(bbox.neLng),
  })

  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/aishub] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []

    // AIS Hub returns [metadataObj, vesselsArray]. Defensive parsing:
    let vessels: Array<Record<string, unknown>> = []
    if (data.length === 2 && Array.isArray(data[1])) {
      const meta = data[0] as Record<string, unknown>
      if (meta?.ERROR === true) {
        console.warn('[raw-signals/aishub] API returned ERROR:', meta.ERROR_MESSAGE ?? '(no message)')
        return []
      }
      vessels = data[1] as Array<Record<string, unknown>>
    } else if (Array.isArray(data[0])) {
      // Alternate shape: plain array of vessels
      vessels = data as Array<Record<string, unknown>>
    }

    return vessels.slice(0, 200).map((v) => {
      const type = typeof v.TYPE === 'number' ? (v.TYPE as number) : parseInt(String(v.TYPE ?? 0), 10) || 0
      const lat = typeof v.LATITUDE === 'number' ? (v.LATITUDE as number) : parseFloat(String(v.LATITUDE ?? 'NaN'))
      const lon = typeof v.LONGITUDE === 'number' ? (v.LONGITUDE as number) : parseFloat(String(v.LONGITUDE ?? 'NaN'))
      return {
        mmsi: String(v.MMSI ?? ''),
        name: v.NAME ? String(v.NAME).trim() : undefined,
        callsign: v.CALLSIGN ? String(v.CALLSIGN).trim() : undefined,
        imo: v.IMO ? String(v.IMO) : undefined,
        type: String(type),
        typeLabel: classifyShipType(type),
        lat,
        lon,
        speedKn: typeof v.SOG === 'number' ? (v.SOG as number) : undefined,
        courseDeg: typeof v.COG === 'number' ? (v.COG as number) : undefined,
        heading: typeof v.HEADING === 'number' ? (v.HEADING as number) : undefined,
        navstat: typeof v.NAVSTAT === 'number' ? (v.NAVSTAT as number) : undefined,
        timestamp: v.TIME ? String(v.TIME) : undefined,
        source: 'aishub' as const,
      }
    }).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
  } catch (err) {
    console.warn('[raw-signals/aishub] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess maritime vessel AIS positioning against a news story.
Given vessels in the story's bounding box (tankers, cargo, naval, fishing, etc.) and the story, return:
- relevantVessels: count of vessels materially relevant to the story (e.g. tankers in a closed strait, naval vessels near a conflict zone)
- tankerCount, militaryCount, cargoCount
- narrativeGap: true if vessel positioning contradicts or adds material context the narrative omits (e.g. tankers still transiting a "closed" strait)
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantVessels": 0, "tankerCount": 0, "militaryCount": 0, "cargoCount": 0, "narrativeGap": false, "description": "" }`

export const aisHubRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const vessels = await aisHubFetch(geo.boundingBox)

  if (vessels.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, vessels: [], note: 'AIS Hub returned empty (no key, no vessels in bbox, or rate limit)' },
      haikuSummary: 'No AIS vessel positions retrieved for region.',
      signalSource: 'aishub', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantVessels: 0, tankerCount: 0, militaryCount: 0, cargoCount: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const sample = vessels.slice(0, 20).map((v, i) =>
      `${i + 1}. ${v.name ?? v.mmsi} | ${v.typeLabel} | ${v.lat.toFixed(2)},${v.lon.toFixed(2)} | ${v.speedKn?.toFixed(1) ?? '?'}kn`,
    ).join('\n')
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nAIS positions (AIS Hub, ${vessels.length} total, sample 20):\n${sample}`,
      agentType: 'raw_signal_maritime_ais', maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/aishub] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.relevantVessels > 0

  return {
    rawContent: {
      bbox: geo.boundingBox,
      vessels: vessels.slice(0, 25),
      totals: { all: vessels.length, tankers: assessment.tankerCount, military: assessment.militaryCount, cargo: assessment.cargoCount },
      assessment,
      haikuCostUsd: haikuCost,
    },
    haikuSummary: `${assessment.relevantVessels} relevant vessels (${assessment.tankerCount} tanker, ${assessment.militaryCount} military)`,
    signalSource: 'aishub', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.relevantVessels >= 5 ? 'high' : assessment.relevantVessels >= 1 ? 'medium' : 'low',
  }
}
