/**
 * OpenSky Network — aviation_adsb backup provider.
 *
 * ── Environment Variables: OPENSKY_USERNAME + OPENSKY_PASSWORD (optional but
 *    strongly recommended — authenticated access gets higher rate limits;
 *    anonymous access returns data but is aggressively throttled).
 * ── Cost: Free (academic/public use).
 * ── What: Fallback helper used by adsb-exchange.ts when ADSBX returns
 *    empty or is rate-limited. Exports `openSkyFetch` — NOT registered as a
 *    standalone runner; aviation_adsb remains served by adsb-exchange.ts
 *    with this as its fallback.
 *
 * Register free account at: https://opensky-network.org/
 */

import { fetchWithTimeout } from '@/lib/utils'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 15_000
const API_URL = 'https://opensky-network.org/api/states/all'

export interface OpenSkyAircraft {
  hex: string
  callsign?: string
  originCountry?: string
  lat?: number
  lon?: number
  altMeters?: number
  velocityMs?: number
  trackDeg?: number
  onGround?: boolean
  positionSource?: number
  source: 'opensky'
}

/**
 * Fetch aircraft states in a bounding box via OpenSky.
 * Returns [] on fetch failure or auth issues (never throws).
 *
 * OpenSky /states/all returns an array of arrays in this order:
 *   [icao24, callsign, origin_country, time_position, last_contact,
 *    longitude, latitude, baro_altitude, on_ground, velocity, true_track,
 *    vertical_rate, sensors, geo_altitude, squawk, spi, position_source]
 */
export async function openSkyFetch(bbox: BoundingBox | null): Promise<OpenSkyAircraft[]> {
  if (!bbox) return []

  const params = new URLSearchParams({
    lamin: String(bbox.swLat),
    lomin: String(bbox.swLng),
    lamax: String(bbox.neLat),
    lomax: String(bbox.neLng),
  })

  const user = process.env.OPENSKY_USERNAME
  const pass = process.env.OPENSKY_PASSWORD
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (user && pass) {
    headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
  }

  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, { headers })
    if (!res.ok) {
      console.warn(`[raw-signals/opensky] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { states?: Array<Array<unknown>> | null }
    const states = data.states ?? []
    if (!Array.isArray(states)) return []
    return states.slice(0, 100).map((s) => ({
      hex: String(s[0] ?? ''),
      callsign: typeof s[1] === 'string' ? s[1].trim() : undefined,
      originCountry: typeof s[2] === 'string' ? s[2] : undefined,
      lon: typeof s[5] === 'number' ? s[5] : undefined,
      lat: typeof s[6] === 'number' ? s[6] : undefined,
      altMeters: typeof s[7] === 'number' ? s[7] : undefined,
      onGround: typeof s[8] === 'boolean' ? s[8] : undefined,
      velocityMs: typeof s[9] === 'number' ? s[9] : undefined,
      trackDeg: typeof s[10] === 'number' ? s[10] : undefined,
      positionSource: typeof s[16] === 'number' ? s[16] : undefined,
      source: 'opensky' as const,
    })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
  } catch (err) {
    console.warn('[raw-signals/opensky] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}
