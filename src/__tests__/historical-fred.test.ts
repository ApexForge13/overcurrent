import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFredObservations, fetchFredSeries } from '@/lib/historical-data/fred-client'

describe('parseFredObservations', () => {
  it('returns [] for empty body', () => {
    expect(parseFredObservations({})).toEqual([])
    expect(parseFredObservations({ observations: [] })).toEqual([])
  })

  it('parses numeric values correctly', () => {
    const result = parseFredObservations({
      observations: [
        { date: '2024-01-01', value: '3.7' },
        { date: '2024-02-01', value: '3.9' },
      ],
    })
    expect(result).toEqual([
      { date: '2024-01-01', value: 3.7 },
      { date: '2024-02-01', value: 3.9 },
    ])
  })

  it('skips "." (FRED no-data sentinel)', () => {
    const result = parseFredObservations({
      observations: [
        { date: '2024-01-01', value: '3.7' },
        { date: '2024-02-01', value: '.' },
        { date: '2024-03-01', value: '3.9' },
      ],
    })
    expect(result).toHaveLength(2)
    expect(result[0].date).toBe('2024-01-01')
    expect(result[1].date).toBe('2024-03-01')
  })

  it('skips malformed rows', () => {
    const result = parseFredObservations({
      observations: [
        { date: '2024-01-01', value: 'not-a-number' },
        { date: '2024-02-01', value: '3.9' },
        { date: '', value: '4.0' },
      ] as unknown as Array<{ date: string; value: string }>,
    })
    // The 'not-a-number' parses to NaN, which we skip
    expect(result.every((r) => !Number.isNaN(r.value))).toBe(true)
    expect(result.map((r) => r.value)).toContain(3.9)
  })
})

describe('fetchFredSeries', () => {
  beforeEach(() => {
    process.env.FRED_API_KEY = 'test-key'
  })

  afterEach(() => {
    delete process.env.FRED_API_KEY
  })

  it('throws when FRED_API_KEY is missing', async () => {
    delete process.env.FRED_API_KEY
    await expect(fetchFredSeries('PAYEMS')).rejects.toThrow(/FRED_API_KEY/)
  })

  it('calls the correct URL with params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ observations: [{ date: '2024-01-01', value: '3.7' }] }),
    } as Response)

    const result = await fetchFredSeries('PAYEMS', {
      fetchImpl,
      observationStart: '2019-01-01',
      observationEnd: '2024-01-01',
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    const url = (fetchImpl.mock.calls[0]?.[0] as string) ?? ''
    expect(url).toContain('series_id=PAYEMS')
    expect(url).toContain('api_key=test-key')
    expect(url).toContain('file_type=json')
    expect(url).toContain('observation_start=2019-01-01')
    expect(result).toHaveLength(1)
  })

  it('throws with status info on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response)

    await expect(fetchFredSeries('BADID', { fetchImpl })).rejects.toThrow(/FRED fetch failed/)
  })
})
