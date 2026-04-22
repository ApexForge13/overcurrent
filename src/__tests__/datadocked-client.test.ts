import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchVesselsByArea,
  fetchVesselLocation,
  parseVessel,
  classifyShipType,
} from '@/lib/raw-signals/clients/datadocked-client'

function mockFetchJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const headersObj = { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null }
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: async () => body,
  })
}

describe('datadocked-client', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {})
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('classifyShipType maps AIS codes to labels', () => {
    expect(classifyShipType(80)).toBe('tanker')
    expect(classifyShipType(89)).toBe('tanker')
    expect(classifyShipType(70)).toBe('cargo')
    expect(classifyShipType(35)).toBe('military')
    expect(classifyShipType(60)).toBe('passenger')
    expect(classifyShipType(53)).toBe('port_tender')
    expect(classifyShipType(0)).toBe('other')
  })

  it('parseVessel normalizes key + alt field names', () => {
    const v = parseVessel({
      mmsi: 12345,
      ship_type: 81,
      lat: 26.5,
      lon: 50.2,
      name: 'Test Tanker',
      speed: 12.5,
    })
    expect(v).not.toBeNull()
    expect(v?.mmsi).toBe('12345')
    expect(v?.typeLabel).toBe('tanker')
    expect(v?.lat).toBe(26.5)
    expect(v?.name).toBe('Test Tanker')
    expect(v?.speedKn).toBe(12.5)
  })

  it('parseVessel returns null on missing mmsi or bad coordinates', () => {
    expect(parseVessel({})).toBeNull()
    expect(parseVessel({ mmsi: '123', lat: 'bad', lon: 50 })).toBeNull()
  })

  it('fetchVesselsByArea parses data array', async () => {
    globalThis.fetch = mockFetchJson({
      data: [
        { mmsi: 1, ship_type: 81, lat: 26.5, lon: 50.2 },
        { mmsi: 2, ship_type: 70, lat: 26.6, lon: 50.3 },
      ],
    })
    const out = await fetchVesselsByArea({ swLat: 26, swLng: 50, neLat: 27, neLng: 51 }, 'k')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value).toHaveLength(2)
    expect(out.value[0].typeLabel).toBe('tanker')
  })

  it('fetchVesselsByArea parses data.vessels nested shape', async () => {
    globalThis.fetch = mockFetchJson({
      data: { vessels: [{ mmsi: 5, ship_type: 80, lat: 1, lon: 1 }] },
    })
    const out = await fetchVesselsByArea({ swLat: 0, swLng: 0, neLat: 2, neLng: 2 }, 'k')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value).toHaveLength(1)
  })

  it('401 routes to auth_failed', async () => {
    globalThis.fetch = mockFetchJson({}, 401)
    const out = await fetchVesselsByArea({ swLat: 0, swLng: 0, neLat: 1, neLng: 1 }, 'k')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('auth_failed')
  })

  it('fetchVesselLocation extracts single vessel from nested shape', async () => {
    globalThis.fetch = mockFetchJson({
      data: { vessel: { mmsi: 42, ship_type: 81, lat: 5, lon: 5, name: 'Solo Tanker' } },
    })
    const out = await fetchVesselLocation('42', 'k')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value.name).toBe('Solo Tanker')
  })

  it('429 rate-limit returns retryAfterSec from header', async () => {
    globalThis.fetch = mockFetchJson({}, 429, { 'retry-after': '120' })
    const out = await fetchVesselsByArea({ swLat: 0, swLng: 0, neLat: 1, neLng: 1 }, 'k')
    expect(out.ok).toBe(false)
    if (out.ok || out.errorType !== 'rate_limited') throw new Error()
    expect(out.retryAfterSec).toBe(120)
  })
})
