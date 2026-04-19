/**
 * MarineTraffic / Kpler — premium upgrade path (DORMANT, NOT REGISTERED).
 *
 * ── Status: NOT USED AT RUNTIME.
 *    maritime_ais is served by vesselfinder.ts (free tier, bounding-box
 *    queries supported, viable at current stage). This file is a reference
 *    scaffold for when enterprise contracts justify MarineTraffic or Kpler
 *    pricing.
 *
 * ── Why dormant:
 *    MarineTraffic's free tier does not reliably support bounding-box vessel
 *    position queries — most free endpoints focus on single-vessel lookups
 *    by MMSI/IMO. Their bbox-query tiers are enterprise-priced ($thousands/
 *    month). Kpler (their premium cousin for commodity/shipping analytics)
 *    is also enterprise-priced. Neither is viable for consumer or B2B
 *    researcher/organization tiers.
 *
 * ── When to activate:
 *    When enterprise clients are paying $20,000+/month and the monitoring
 *    daemon needs higher-fidelity vessel data (more frequent updates,
 *    better ship-type/flag attribution, voyage history) than VesselFinder
 *    free tier provides. At that point:
 *      1. Enable a MarineTraffic or Kpler subscription on the enterprise-
 *         dedicated deployment
 *      2. Flip maritime_ais registration in integrations/index.ts from
 *         vesselFinderRunner to marineTrafficRunner (restore the export
 *         below)
 *      3. Keep vesselfinder.ts as the budget-tier fallback
 *
 * ── Environment Variables (when activated): MARINETRAFFIC_API_KEY or KPLER_API_KEY
 * ── Cost (when activated): Enterprise ($thousands/month minimum)
 *
 * For now, do not import or register anything from this file. The fetch
 * function below is retained as a starting point for future implementation.
 */

import { fetchWithTimeout } from '@/lib/utils'
import type { BoundingBox } from '../types'

// Local vessel shape — was previously imported from vesselfinder.ts.
// vesselfinder.ts has been removed; Datalastic (datadocked.ts) is the
// registered primary. Kept as a local type so this dormant scaffold
// remains self-contained.
interface VesselPosition {
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
  source: string
}

const TIMEOUT_MS = 15_000
const MT_API_URL = 'https://services.marinetraffic.com/api/exportvessels/v:8'

/**
 * Scaffold-only fetch for MarineTraffic exportvessels. Not wired into any
 * runner. When activating the premium upgrade, audit this against current
 * MarineTraffic/Kpler API docs before use — endpoint + parameters drift
 * between plan tiers.
 */
export async function marineTrafficFetchScaffold(bbox: BoundingBox | null): Promise<VesselPosition[]> {
  if (!bbox) return []
  const key = process.env.MARINETRAFFIC_API_KEY
  if (!key) return [] // dormant — no warn, expected

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
    if (!res.ok) return []
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
        source: 'vesselfinder' as const,
      }
    }).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
  } catch {
    return []
  }
}
