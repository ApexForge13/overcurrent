/**
 * MarineTraffic free tier — maritime_ais primary provider.
 *
 * ── Environment Variables: MARINETRAFFIC_API_KEY (required, free tier).
 * ── Cost: Free tier (per-day credit limits).
 * ── What: Primary runner for maritime_ais. Queries vessel positions in
 *    the story's bounding box, deduplicates with VesselFinder fallback,
 *    classifies ship types (tanker / cargo / naval / government /
 *    fishing / passenger), and assesses via Haiku whether vessel
 *    positioning diverges from narrative claims.
 *
 *    The MarineTraffic free tier has limited bbox-query support — most
 *    free endpoints focus on single-vessel lookups. We issue a best-effort
 *    free-tier request and fall back to VesselFinder (which has better
 *    free-tier bounding-box support) when MT returns empty.
 *
 * Register free key at: https://www.marinetraffic.com/en/ais-api-services
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import { vesselFinderFetch, type VesselPosition } from './vesselfinder'
import type { IntegrationRunner } from '../runner'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 15_000
// Best-effort free-tier endpoint — returns recent vessel positions in
// area. This endpoint + param names vary by plan; the runner degrades
// gracefully and falls back to VesselFinder when MT returns nothing.
const MT_API_URL = 'https://services.marinetraffic.com/api/exportvessels/v:8'

async function marineTrafficFetch(bbox: BoundingBox | null): Promise<VesselPosition[]> {
  if (!bbox) return []
  const key = process.env.MARINETRAFFIC_API_KEY
  if (!key) {
    console.warn('[raw-signals/marinetraffic] MARINETRAFFIC_API_KEY missing — falling back to VesselFinder')
    return []
  }

  // MT expects: MINLAT/MAXLAT/MINLON/MAXLON in MSGTYPE=simple format on supported tiers
  const params = new URLSearchParams({
    MINLAT: String(bbox.swLat),
    MAXLAT: String(bbox.neLat),
    MINLON: String(bbox.swLng),
    MAXLON: String(bbox.neLng),
    protocol: 'jsono',
    msgtype: 'simple',
    timespan: '10',
  })
  const url = `${MT_API_URL}/${encodeURIComponent(key)}?${params}`

  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/marinetraffic] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []
    return (data as Array<Record<string, unknown>>).slice(0, 200).map((v) => {
      const typeNum = parseInt(String(v.SHIPTYPE ?? v.TYPE ?? 0), 10) || 0
      let typeLabel = 'other'
      if (typeNum >= 80 && typeNum <= 89) typeLabel = 'tanker'
      else if (typeNum >= 70 && typeNum <= 79) typeLabel = 'cargo'
      else if (typeNum === 35) typeLabel = 'military'
      else if (typeNum >= 30 && typeNum <= 39) typeLabel = 'fishing_or_special'
      else if (typeNum >= 60 && typeNum <= 69) typeLabel = 'passenger'
      return {
        mmsi: String(v.MMSI ?? ''),
        name: v.SHIPNAME ? String(v.SHIPNAME) : undefined,
        callsign: v.CALLSIGN ? String(v.CALLSIGN) : undefined,
        imo: v.IMO ? String(v.IMO) : undefined,
        type: String(typeNum),
        typeLabel,
        lat: parseFloat(String(v.LAT ?? 'NaN')),
        lon: parseFloat(String(v.LON ?? 'NaN')),
        speedKn: typeof v.SPEED === 'number' ? (v.SPEED as number) / 10 : undefined,
        courseDeg: typeof v.COURSE === 'number' ? (v.COURSE as number) / 10 : undefined,
        heading: typeof v.HEADING === 'number' ? (v.HEADING as number) : undefined,
        timestamp: v.TIMESTAMP ? String(v.TIMESTAMP) : undefined,
        source: 'vesselfinder' as const, // shared shape with VesselFinder helper
      }
    }).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
  } catch (err) {
    console.warn('[raw-signals/marinetraffic] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

function dedupByMmsi(vessels: VesselPosition[]): VesselPosition[] {
  const seen = new Set<string>()
  const out: VesselPosition[] = []
  for (const v of vessels) {
    if (!v.mmsi || seen.has(v.mmsi)) continue
    seen.add(v.mmsi)
    out.push(v)
  }
  return out
}

const HAIKU_SYSTEM = `You assess maritime vessel AIS positioning against a news story.
Given vessels in the story's bounding box (tankers, cargo, naval, fishing, etc.) and the story, return:
- relevantVessels: count of vessels materially relevant to the story (e.g. tankers in a closed strait, naval vessels near a conflict zone)
- tankerCount, militaryCount, cargoCount
- narrativeGap: true if vessel positioning contradicts or adds material context the narrative omits (e.g. tankers still transiting a "closed" strait)
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantVessels": 0, "tankerCount": 0, "militaryCount": 0, "cargoCount": 0, "narrativeGap": false, "description": "" }`

export const marineTrafficRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)

  // Try primary (MarineTraffic) then fall back to VesselFinder
  let vessels = await marineTrafficFetch(geo.boundingBox)
  let source: 'marinetraffic' | 'vesselfinder' | 'both' = 'marinetraffic'
  if (vessels.length === 0) {
    const fallback = await vesselFinderFetch(geo.boundingBox)
    if (fallback.length > 0) {
      vessels = fallback
      source = 'vesselfinder'
    }
  } else {
    // Combine + dedupe both when MT returned some (shouldn't hurt — more data)
    const fallback = await vesselFinderFetch(geo.boundingBox)
    if (fallback.length > 0) {
      vessels = dedupByMmsi([...vessels, ...fallback])
      source = 'both'
    }
  }

  if (vessels.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, vessels: [], note: 'Both MT + VesselFinder returned empty' },
      haikuSummary: 'No AIS vessel positions retrieved for region.',
      signalSource: source, captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
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
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nAIS positions (${source}, ${vessels.length} total, sample 20):\n${sample}`,
      agentType: 'raw_signal_maritime_ais', maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/maritime-ais] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.relevantVessels > 0

  return {
    rawContent: {
      bbox: geo.boundingBox,
      source,
      vessels: vessels.slice(0, 25),
      totals: { all: vessels.length, tankers: assessment.tankerCount, military: assessment.militaryCount, cargo: assessment.cargoCount },
      assessment,
      haikuCostUsd: haikuCost,
    },
    haikuSummary: `${assessment.relevantVessels} relevant vessels (${assessment.tankerCount} tanker, ${assessment.militaryCount} military) via ${source}`,
    signalSource: source, captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.relevantVessels >= 5 ? 'high' : assessment.relevantVessels >= 1 ? 'medium' : 'low',
  }
}
