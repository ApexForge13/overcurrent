import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEiaResponse, fetchEiaSeries, EIA_INDICATORS } from '@/lib/historical-data/eia-client'

describe('parseEiaResponse', () => {
  it('returns [] for missing response body', () => {
    expect(parseEiaResponse({}, 'value', 'Bcf')).toEqual([])
    expect(parseEiaResponse({ response: {} }, 'value', 'Bcf')).toEqual([])
    expect(parseEiaResponse({ response: { data: [] } }, 'value', 'Bcf')).toEqual([])
  })

  it('parses numeric values', () => {
    const result = parseEiaResponse(
      {
        response: {
          data: [
            { period: '2024-01-05', value: 2500 },
            { period: '2024-01-12', value: 2400 },
          ],
        },
      },
      'value',
      'thousand bbl',
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ periodEnd: '2024-01-05', value: 2500, unit: 'thousand bbl' })
  })

  it('coerces string values to numbers', () => {
    const result = parseEiaResponse(
      { response: { data: [{ period: '2024-01-01', value: '123.45' }] } },
      'value',
      'Bcf',
    )
    expect(result[0].value).toBe(123.45)
  })

  it('skips rows with missing period or NaN value', () => {
    const result = parseEiaResponse(
      {
        response: {
          data: [
            { period: '2024-01-01', value: 100 },
            { period: null, value: 200 },
            { period: '2024-01-03', value: 'junk' },
            { period: '2024-01-04', value: 400 },
          ],
        },
      } as unknown as { response: { data: Array<Record<string, unknown>> } },
      'value',
      'Bcf',
    )
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.value)).toEqual([100, 400])
  })
})

describe('fetchEiaSeries', () => {
  const spec = EIA_INDICATORS[0] // crude

  beforeEach(() => {
    process.env.EIA_API_KEY = 'test-key'
  })

  afterEach(() => {
    delete process.env.EIA_API_KEY
  })

  it('throws when EIA_API_KEY is missing', async () => {
    delete process.env.EIA_API_KEY
    await expect(fetchEiaSeries(spec)).rejects.toThrow(/EIA_API_KEY/)
  })

  it('calls v2 endpoint with appended facet params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: { data: [{ period: '2024-01-05', value: 2500 }] },
      }),
    } as Response)

    const result = await fetchEiaSeries(spec, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const url = fetchImpl.mock.calls[0]?.[0] as string
    expect(url).toContain('api.eia.gov/v2/')
    expect(url).toContain(spec.apiPath)
    expect(url).toContain('api_key=test-key')
    expect(result).toHaveLength(1)
  })
})
