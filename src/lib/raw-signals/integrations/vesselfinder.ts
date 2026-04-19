/**
 * VesselFinder — paid upgrade path (DORMANT, NOT REGISTERED).
 *
 * ── Status: NOT USED AT RUNTIME.
 *    maritime_ais is served by aishub.ts (AIS Hub free tier supports
 *    bounding-box queries with generous limits). VesselFinder's free
 *    tier has tighter per-day volume limits and the paid tiers are
 *    only worthwhile at enterprise revenue. This file retains the
 *    VesselPosition shared type and a dormant fetch helper so the
 *    module can be promoted quickly if AIS Hub's free tier becomes
 *    insufficient.
 *
 * ── When to activate:
 *    When AIS Hub per-day rate limits become a production constraint
 *    OR when the customer mix demands higher-resolution data than AIS
 *    Hub provides. At that point:
 *      1. Register VESSELFINDER_API_KEY
 *      2. Restore the runner export (git history has the promoted
 *         version from commit 842ca10 if needed)
 *      3. Flip maritime_ais registration in integrations/index.ts
 *         from aisHubRunner to vesselFinderRunner, or chain both
 *         (AIS Hub primary, VesselFinder fallback)
 *
 * ── Environment Variables (when activated): VESSELFINDER_API_KEY
 * ── Cost (when activated): Free tier with tight per-day limits; paid
 *    tiers scale with volume.
 *
 * MarineTraffic / Kpler is the enterprise-tier upgrade path above this —
 * see marinetraffic.ts.
 */

import { fetchWithTimeout } from '@/lib/utils'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 15_000
const API_URL = 'https://api.vesselfinder.com/vesselslist'

/** Shared vessel-position shape used across all maritime_ais providers. */
export interface VesselPosition {
  mmsi: string
  name?: string
  callsign?: string
  imo?: string
  type?: string
  typeLabel?: string
  lat: number
  lon: number
  speedKn?: number
  courseDeg?: number
  heading?: number
  timestamp?: string
  source: 'vesselfinder'
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
 * Dormant fetch helper. Retained for quick re-activation. Not registered
 * with any runner today. Returns [] without a key — expected, no warning.
 */
export async function vesselFinderFetch(bbox: BoundingBox | null): Promise<VesselPosition[]> {
  if (!bbox) return []
  const key = process.env.VESSELFINDER_API_KEY
  if (!key) return [] // dormant — no warn

  const bboxParam = `${bbox.swLng},${bbox.swLat},${bbox.neLng},${bbox.neLat}`
  const url = `${API_URL}?userkey=${encodeURIComponent(key)}&bbox=${encodeURIComponent(bboxParam)}&format=json`

  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
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
  } catch {
    return []
  }
}
