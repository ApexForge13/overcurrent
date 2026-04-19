/**
 * VesselFinder — maritime_ais backup provider.
 *
 * ── Environment Variables: VESSELFINDER_API_KEY (required, free tier).
 * ── Cost: Free tier (per-day limits).
 * ── What: Used as the fallback fetch when MarineTraffic returns empty.
 *    Exports `vesselFinderFetch` as a helper — NOT registered as a standalone
 *    runner. maritime_ais is served by marinetraffic.ts which calls this
 *    on fallback and deduplicates by MMSI.
 *
 * Register free key at: https://api.vesselfinder.com/signup
 * Supports bounding-box queries on the free tier (limited volume).
 */

import { fetchWithTimeout } from '@/lib/utils'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 15_000
const API_URL = 'https://api.vesselfinder.com/vesselslist'

export interface VesselPosition {
  mmsi: string
  name?: string
  callsign?: string
  imo?: string
  type?: string        // AIS ship type code (e.g. 80-89 = tanker, 70-79 = cargo)
  typeLabel?: string   // human label
  lat: number
  lon: number
  speedKn?: number
  courseDeg?: number
  heading?: number
  timestamp?: string   // position timestamp
  source: 'vesselfinder'
}

// AIS ship type ranges that matter for narrative cross-reference:
// 30-39: fishing, special craft
// 60-69: passenger
// 70-79: cargo
// 80-89: tanker (petroleum, chemical, LNG, LPG)
// 35: military (reserved in some jurisdictions)
// 53: port tender
function classifyShipType(type: number): string {
  if (type >= 80 && type <= 89) return 'tanker'
  if (type >= 70 && type <= 79) return 'cargo'
  if (type >= 30 && type <= 39) return 'fishing_or_special'
  if (type === 35) return 'military'
  if (type >= 60 && type <= 69) return 'passenger'
  if (type === 53) return 'port_tender'
  return 'other'
}

/**
 * Fetch vessel positions in a bounding box via VesselFinder free-tier API.
 * Returns [] on missing key or fetch failure (never throws).
 */
export async function vesselFinderFetch(bbox: BoundingBox | null): Promise<VesselPosition[]> {
  if (!bbox) return []
  const key = process.env.VESSELFINDER_API_KEY
  if (!key) {
    console.warn('[raw-signals/vesselfinder] VESSELFINDER_API_KEY missing — returning empty')
    return []
  }

  // VesselFinder bbox format: minLon,minLat,maxLon,maxLat
  const bboxParam = `${bbox.swLng},${bbox.swLat},${bbox.neLng},${bbox.neLat}`
  const url = `${API_URL}?userkey=${encodeURIComponent(key)}&bbox=${encodeURIComponent(bboxParam)}&format=json`

  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/vesselfinder] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as Array<Record<string, unknown>>
    if (!Array.isArray(data)) return []
    return data.slice(0, 200).map((v) => {
      const type = typeof v.TYPE === 'number' ? (v.TYPE as number) : parseInt(String(v.TYPE ?? 0), 10) || 0
      return {
        mmsi: String(v.MMSI ?? ''),
        name: v.NAME ? String(v.NAME) : undefined,
        callsign: v.CALLSIGN ? String(v.CALLSIGN) : undefined,
        imo: v.IMO ? String(v.IMO) : undefined,
        type: String(type),
        typeLabel: classifyShipType(type),
        lat: typeof v.LATITUDE === 'number' ? (v.LATITUDE as number) : parseFloat(String(v.LATITUDE ?? 'NaN')),
        lon: typeof v.LONGITUDE === 'number' ? (v.LONGITUDE as number) : parseFloat(String(v.LONGITUDE ?? 'NaN')),
        speedKn: typeof v.SPEED === 'number' ? (v.SPEED as number) : undefined,
        courseDeg: typeof v.COURSE === 'number' ? (v.COURSE as number) : undefined,
        heading: typeof v.HEADING === 'number' ? (v.HEADING as number) : undefined,
        timestamp: v.TIMESTAMP ? String(v.TIMESTAMP) : undefined,
        source: 'vesselfinder' as const,
      }
    }).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
  } catch (err) {
    console.warn('[raw-signals/vesselfinder] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}
