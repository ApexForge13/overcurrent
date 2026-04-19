/**
 * Datalastic / Data Docked — maritime_ais PRIMARY provider.
 *
 * ── Environment Variables: DATADOCKED_API_KEY (required, paid account).
 * ── Cost: paid at ~$87/month, covers bounding box geographic queries for
 *    vessel positions. Self-serve signup at datalastic.com.
 *    Subscription tier gives predictable rate limits + commercial-use rights
 *    which the AIS Hub / VesselFinder free tiers do not.
 * ── What: Queries vessel positions in the story's bounding box via
 *    Datalastic's vessel_inarea endpoint. Returns full AIS fields (MMSI,
 *    IMO, name, callsign, ship type code, position, speed, course, flag,
 *    destination). Classifies ship-type codes into labels (tanker / cargo
 *    / military / fishing / passenger) and Haiku-assesses whether vessel
 *    positioning contradicts or adds material context the narrative omits
 *    (e.g. tankers still transiting a "closed" strait).
 *
 *    Priority order for maritime_ais data providers:
 *      1. Datalastic (this runner) — registered primary, $87/month
 *      2. AIS Hub (aishub.ts) — dormant free-tier option, can be promoted
 *         if Datalastic is unreachable during a run (Phase 10 could wire
 *         as a fallback if that failure mode shows up in practice)
 *      3. VesselFinder — replaced by this integration; file removed
 *      4. MarineTraffic / Kpler (marinetraffic.ts) — enterprise upgrade
 *         path for when the $87 tier becomes insufficient
 *
 * Sign up: https://datalastic.com/
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 15_000
// Datalastic v0 bounding-box endpoint. Accepts lat_min / lat_max / lon_min
// / lon_max and api-key in query params. Response contains `data` array of
// vessel objects.
const API_URL = 'https://api.datalastic.com/api/v0/vessel_inarea'

export interface DatadockedVessel {
  uuid?: string
  mmsi: string
  imo?: string
  name?: string
  callsign?: string
  type?: string        // AIS ship type code
  typeLabel?: string   // derived human label
  flag?: string
  lat: number
  lon: number
  speedKn?: number     // speed in knots
  courseDeg?: number
  heading?: number
  destination?: string
  eta?: string
  navigationalStatus?: string
  lastPositionAt?: string
  source: 'datadocked'
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
 * Fetch vessel positions in a bounding box via Datalastic. Returns [] on
 * missing key or fetch failure (never throws). Defensive about response
 * shape — Datalastic's field names vary across endpoint versions.
 */
async function datadockedFetch(bbox: BoundingBox | null): Promise<DatadockedVessel[]> {
  if (!bbox) return []
  const key = process.env.DATADOCKED_API_KEY
  if (!key) {
    console.warn('[raw-signals/datadocked] DATADOCKED_API_KEY missing — returning empty')
    return []
  }

  const params = new URLSearchParams({
    'api-key': key,
    lat_min: String(bbox.swLat),
    lat_max: String(bbox.neLat),
    lon_min: String(bbox.swLng),
    lon_max: String(bbox.neLng),
  })

  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/datadocked] HTTP ${res.status}`)
      return []
    }
    const payload = (await res.json()) as Record<string, unknown>
    // Datalastic typically returns { data: [...] } or { data: { vessels: [...] } }
    const candidates: Array<Record<string, unknown>> = Array.isArray(payload.data)
      ? (payload.data as Array<Record<string, unknown>>)
      : Array.isArray((payload.data as Record<string, unknown>)?.vessels)
        ? ((payload.data as Record<string, unknown>).vessels as Array<Record<string, unknown>>)
        : []

    return candidates.slice(0, 200).map((v) => {
      const typeRaw = v.ship_type ?? v.type ?? v.SHIPTYPE ?? 0
      const typeNum = typeof typeRaw === 'number' ? typeRaw : parseInt(String(typeRaw), 10) || 0
      const lat = typeof v.lat === 'number'
        ? v.lat
        : typeof v.latitude === 'number'
          ? v.latitude
          : parseFloat(String(v.lat ?? v.latitude ?? 'NaN'))
      const lon = typeof v.lon === 'number'
        ? v.lon
        : typeof v.longitude === 'number'
          ? v.longitude
          : parseFloat(String(v.lon ?? v.longitude ?? 'NaN'))
      return {
        uuid: v.uuid ? String(v.uuid) : undefined,
        mmsi: String(v.mmsi ?? v.MMSI ?? ''),
        imo: v.imo ? String(v.imo) : undefined,
        name: v.name ? String(v.name).trim() : v.NAME ? String(v.NAME).trim() : undefined,
        callsign: v.callsign ? String(v.callsign).trim() : undefined,
        type: String(typeNum),
        typeLabel: classifyShipType(typeNum),
        flag: v.flag ? String(v.flag) : v.country_iso ? String(v.country_iso) : undefined,
        lat,
        lon,
        speedKn: typeof v.speed === 'number' ? (v.speed as number) : typeof v.sog === 'number' ? (v.sog as number) : undefined,
        courseDeg: typeof v.course === 'number' ? (v.course as number) : typeof v.cog === 'number' ? (v.cog as number) : undefined,
        heading: typeof v.heading === 'number' ? (v.heading as number) : undefined,
        destination: v.destination ? String(v.destination) : undefined,
        eta: v.eta ? String(v.eta) : undefined,
        navigationalStatus: v.navigational_status ? String(v.navigational_status) : undefined,
        lastPositionAt: v.last_position_UTC ? String(v.last_position_UTC) : v.last_position_epoch ? String(v.last_position_epoch) : undefined,
        source: 'datadocked' as const,
      }
    }).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
  } catch (err) {
    console.warn('[raw-signals/datadocked] fetch failed:', err instanceof Error ? err.message : err)
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

export const datadockedRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const vessels = await datadockedFetch(geo.boundingBox)

  if (vessels.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, vessels: [], note: 'Datalastic returned empty (no key, no vessels in bbox, or API error)' },
      haikuSummary: 'No AIS vessel positions retrieved for region.',
      signalSource: 'datadocked', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantVessels: 0, tankerCount: 0, militaryCount: 0, cargoCount: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const sample = vessels.slice(0, 20).map((v, i) =>
      `${i + 1}. ${v.name ?? v.mmsi} | ${v.typeLabel} | ${v.flag ?? '?'} | ${v.lat.toFixed(2)},${v.lon.toFixed(2)} | ${v.speedKn?.toFixed(1) ?? '?'}kn | dest=${v.destination ?? '?'}`,
    ).join('\n')
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nAIS positions (Datalastic, ${vessels.length} total, sample 20):\n${sample}`,
      agentType: 'raw_signal_maritime_ais', maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/datadocked] Haiku failed:', err instanceof Error ? err.message : err)
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
    signalSource: 'datadocked', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.relevantVessels >= 5 ? 'high' : assessment.relevantVessels >= 1 ? 'medium' : 'low',
  }
}
