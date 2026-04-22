/**
 * Data Docked shared HTTP + parse client.
 *
 * Extracted from src/lib/raw-signals/integrations/datadocked.ts so the
 * trigger-pipeline (T-GT7 zone scanner) can reuse fetch primitives
 * without inheriting the cluster-scoped Haiku assessment.
 *
 * Target tier: Seafarer ($190/mo, 15K credits/month). Endpoint costs:
 *   get-vessels-by-area    — 10 credits per call (used by zone scanner)
 *   get-vessel-location    — 1 credit per call (investigative drill-down)
 *   port-calls-by-port     — 50 credits per call (NOT used — prohibitive)
 *
 * Rate limits: 50/min on get-vessels-by-area, 100/min on get-vessel-location.
 *
 * ── Env gating ─────────────────────────────────────────────────────────
 * DATADOCKED_API_KEY required. DATADOCKED_SCANNING_ENABLED (second gate)
 * checked at trigger level — not here — so tests can exercise the client
 * without flipping the flag.
 */

import { fetchWithTimeout } from '@/lib/utils'
import { safeStringify } from '../error-shape'

const BASE_URL = 'https://api.datadocked.com/api/v0'
const TIMEOUT_MS = 20_000

export type DatadockedFetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; errorType: 'auth_failed' }
  | { ok: false; errorType: 'rate_limited'; retryAfterSec?: number }
  | { ok: false; errorType: 'client_error'; statusCode: number }
  | { ok: false; errorType: 'server_error'; statusCode: number }
  | { ok: false; errorType: 'timeout' }
  | { ok: false; errorType: 'parse_error'; message: string }
  | { ok: false; errorType: 'unknown'; message: string }

export interface DatadockedVesselPosition {
  mmsi: string
  imo?: string
  name?: string
  callsign?: string
  typeCode: number
  typeLabel: string // 'tanker' | 'cargo' | 'military' | 'fishing_or_special' | 'passenger' | 'port_tender' | 'other'
  flag?: string
  lat: number
  lon: number
  speedKn?: number
  courseDeg?: number
  heading?: number
  destination?: string
  eta?: string
  navigationalStatus?: string
  lastPositionAt?: string
}

export interface BoundingBoxQuery {
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

function parseRetryAfter(headers: { get: (name: string) => string | null }): number | undefined {
  const raw = headers.get('retry-after') ?? headers.get('Retry-After')
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true
    if (/timeout/i.test(err.message)) return true
  }
  return false
}

export function classifyShipType(typeCode: number): DatadockedVesselPosition['typeLabel'] {
  if (typeCode >= 80 && typeCode <= 89) return 'tanker'
  if (typeCode >= 70 && typeCode <= 79) return 'cargo'
  if (typeCode === 35) return 'military'
  if (typeCode >= 30 && typeCode <= 39) return 'fishing_or_special'
  if (typeCode >= 60 && typeCode <= 69) return 'passenger'
  if (typeCode === 53) return 'port_tender'
  return 'other'
}

/**
 * Parse raw Data Docked vessel payload into normalized VesselPosition.
 * Returns null when key fields are missing (mmsi, lat, or lon).
 */
export function parseVessel(raw: Record<string, unknown>): DatadockedVesselPosition | null {
  const mmsi = String(raw.mmsi ?? raw.MMSI ?? '').trim()
  if (!mmsi) return null

  const typeRaw = raw.ship_type ?? raw.type ?? raw.SHIPTYPE ?? 0
  const typeCode = typeof typeRaw === 'number' ? typeRaw : parseInt(String(typeRaw), 10) || 0

  const lat = typeof raw.lat === 'number'
    ? raw.lat
    : typeof raw.latitude === 'number'
      ? raw.latitude
      : parseFloat(String(raw.lat ?? raw.latitude ?? 'NaN'))
  const lon = typeof raw.lon === 'number'
    ? raw.lon
    : typeof raw.longitude === 'number'
      ? raw.longitude
      : parseFloat(String(raw.lon ?? raw.longitude ?? 'NaN'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  return {
    mmsi,
    imo: raw.imo ? String(raw.imo) : undefined,
    name: raw.name ? String(raw.name).trim() : raw.NAME ? String(raw.NAME).trim() : undefined,
    callsign: raw.callsign ? String(raw.callsign).trim() : undefined,
    typeCode,
    typeLabel: classifyShipType(typeCode),
    flag: raw.flag ? String(raw.flag) : raw.country_iso ? String(raw.country_iso) : undefined,
    lat,
    lon,
    speedKn: typeof raw.speed === 'number'
      ? raw.speed
      : typeof raw.sog === 'number'
        ? raw.sog
        : undefined,
    courseDeg: typeof raw.course === 'number'
      ? raw.course
      : typeof raw.cog === 'number'
        ? raw.cog
        : undefined,
    heading: typeof raw.heading === 'number' ? raw.heading : undefined,
    destination: raw.destination ? String(raw.destination) : undefined,
    eta: raw.eta ? String(raw.eta) : undefined,
    navigationalStatus: raw.navigational_status ? String(raw.navigational_status) : undefined,
    lastPositionAt: raw.last_position_UTC
      ? String(raw.last_position_UTC)
      : raw.last_position_epoch
        ? String(raw.last_position_epoch)
        : undefined,
  }
}

/**
 * Fetch vessels in a bounding box. 10 credits per call.
 */
export async function fetchVesselsByArea(
  bbox: BoundingBoxQuery,
  apiKey: string,
): Promise<DatadockedFetchOutcome<DatadockedVesselPosition[]>> {
  const params = new URLSearchParams({
    'api-key': apiKey,
    lat_min: String(bbox.swLat),
    lat_max: String(bbox.neLat),
    lon_min: String(bbox.swLng),
    lon_max: String(bbox.neLng),
  })

  let res: Response
  try {
    res = await fetchWithTimeout(`${BASE_URL}/vessel_inarea?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, errorType: 'timeout' }
    return { ok: false, errorType: 'unknown', message: safeStringify(err) }
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return { ok: false, errorType: 'auth_failed' }
    if (res.status === 429) {
      return { ok: false, errorType: 'rate_limited', retryAfterSec: parseRetryAfter(res.headers) }
    }
    if (res.status >= 500) return { ok: false, errorType: 'server_error', statusCode: res.status }
    return { ok: false, errorType: 'client_error', statusCode: res.status }
  }

  let payload: Record<string, unknown>
  try {
    payload = (await res.json()) as Record<string, unknown>
  } catch (err) {
    return { ok: false, errorType: 'parse_error', message: safeStringify(err) }
  }

  const candidates: Array<Record<string, unknown>> = Array.isArray(payload.data)
    ? (payload.data as Array<Record<string, unknown>>)
    : Array.isArray((payload.data as Record<string, unknown>)?.vessels)
      ? ((payload.data as Record<string, unknown>).vessels as Array<Record<string, unknown>>)
      : []

  const vessels = candidates
    .slice(0, 500)
    .map(parseVessel)
    .filter((v): v is DatadockedVesselPosition => v !== null)

  return { ok: true, value: vessels }
}

/**
 * Fetch single vessel by MMSI. 1 credit per call. Used for investigative
 * drill-down once a zone scan flags an anomaly.
 */
export async function fetchVesselLocation(
  mmsi: string,
  apiKey: string,
): Promise<DatadockedFetchOutcome<DatadockedVesselPosition>> {
  const params = new URLSearchParams({ 'api-key': apiKey, mmsi })
  let res: Response
  try {
    res = await fetchWithTimeout(`${BASE_URL}/vessel_pro?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, errorType: 'timeout' }
    return { ok: false, errorType: 'unknown', message: safeStringify(err) }
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return { ok: false, errorType: 'auth_failed' }
    if (res.status === 429) {
      return { ok: false, errorType: 'rate_limited', retryAfterSec: parseRetryAfter(res.headers) }
    }
    if (res.status >= 500) return { ok: false, errorType: 'server_error', statusCode: res.status }
    return { ok: false, errorType: 'client_error', statusCode: res.status }
  }

  let payload: Record<string, unknown>
  try {
    payload = (await res.json()) as Record<string, unknown>
  } catch (err) {
    return { ok: false, errorType: 'parse_error', message: safeStringify(err) }
  }

  // Payload can be { data: {...vessel} } or { data: { vessel: {...} } }
  let raw: Record<string, unknown> | null = null
  if (payload.data && typeof payload.data === 'object') {
    const d = payload.data as Record<string, unknown>
    if (d.vessel && typeof d.vessel === 'object') {
      raw = d.vessel as Record<string, unknown>
    } else {
      raw = d
    }
  }
  if (!raw) return { ok: false, errorType: 'parse_error', message: 'no vessel in response' }

  const parsed = parseVessel(raw)
  if (!parsed) return { ok: false, errorType: 'parse_error', message: 'vessel missing mmsi or lat/lon' }
  return { ok: true, value: parsed }
}
