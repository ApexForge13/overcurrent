import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fredMacroRunner } from '@/lib/raw-signals/integrations/fred-macro'
import type { RunnerContext } from '@/lib/raw-signals/runner'

// Fixed "today" used across the cluster; lets us hand-craft deterministic
// observation dates for each series without date-drift flakiness.
const TODAY = new Date('2026-04-15T12:00:00Z')

function makeCtx(overrides?: Partial<RunnerContext['cluster']>): RunnerContext {
  return {
    queueId: 'q-fred-1',
    storyClusterId: 'cluster-fred-1',
    umbrellaArcId: null,
    signalType: 'fred_macro',
    triggerLayer: 'category_trigger',
    triggerReason: 'always_on_macro',
    approvedByAdmin: false,
    cluster: {
      id: 'cluster-fred-1',
      headline: 'Macro cluster headline',
      synopsis: 'Macro cluster synopsis',
      firstDetectedAt: TODAY,
      entities: [],
      signalCategory: 'corporate_scandal',
      ...overrides,
    },
  }
}

/**
 * Build a plausible 30-point FRED observations payload for a series.
 * Latest (most recent) observation comes first because FRED is called
 * with sort_order=desc; adapter handles the rest.
 */
function buildObservations(
  latest: number,
  opts?: { yearAgo?: number; tail?: number[] },
): { observations: Array<{ date: string; value: string }> } {
  // 30 monthly-ish observations. Index 0 = newest; index 29 = oldest.
  // If opts.tail provided, use it for indices 1..3 (trailing window).
  const obs: Array<{ date: string; value: string }> = []
  const start = new Date(TODAY)
  for (let i = 0; i < 30; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() - i * 3) // ~3-day cadence covers 90d lookback
    let v: number
    if (i === 0) v = latest
    else if (opts?.tail && i >= 1 && i <= 3) v = opts.tail[i - 1]
    else if (opts?.yearAgo && i === 29) v = opts.yearAgo
    else v = latest // stable series by default
    obs.push({ date: d.toISOString().split('T')[0], value: String(v) })
  }
  return { observations: obs }
}

function mockAllSeriesHealthy(perSeriesLatest?: Record<string, number>) {
  return vi.fn().mockImplementation((url: string) => {
    // Extract series_id from the URL
    const match = url.match(/[?&]series_id=([^&]+)/)
    const seriesId = match ? decodeURIComponent(match[1]) : 'UNKNOWN'
    const latest = perSeriesLatest?.[seriesId] ?? 100
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(buildObservations(latest, { yearAgo: latest * 0.95 })),
    })
  })
}

describe('fredMacroRunner', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.FRED_API_KEY
    process.env.FRED_API_KEY = 'fred_test_key'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.FRED_API_KEY
    else process.env.FRED_API_KEY = originalKey
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns high confidence with 6 series when all default series succeed', async () => {
    vi.stubGlobal('fetch', mockAllSeriesHealthy())
    const result = await fredMacroRunner(makeCtx())
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('fred-macro')
    expect(result!.confidenceLevel).toBe('high')
    const payload = result!.rawContent as {
      series: Array<{
        seriesId: string
        observations: Array<{ date: string; value: number | null }>
        latest: number | null
        yoyPctChange: number | null
        trailingSigma: number | null
      }>
    }
    expect(payload.series).toHaveLength(6)
    for (const s of payload.series) {
      expect(s.seriesId).toBeDefined()
      expect(Array.isArray(s.observations)).toBe(true)
      expect('latest' in s).toBe(true)
      expect('yoyPctChange' in s).toBe(true)
      expect('trailingSigma' in s).toBe(true)
    }
  })

  it('writes auth_failed error row when FRED_API_KEY is missing', async () => {
    delete process.env.FRED_API_KEY
    const result = await fredMacroRunner(makeCtx())
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('fred-macro')
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorVersion: number
      errorType: string
      provider: string
      message: string
      rawSignalQueueId?: string
    }
    expect(payload.errorVersion).toBe(1)
    expect(payload.errorType).toBe('auth_failed')
    expect(payload.provider).toBe('fred')
    expect(payload.rawSignalQueueId).toBe('q-fred-1')
  })

  it('writes rate_limited error row with retryAfterSec when 429 is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '60' : null) },
        json: () => Promise.resolve({}),
      }),
    )
    const result = await fredMacroRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      retryAfterSec?: number
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('rate_limited')
    expect(payload.provider).toBe('fred')
    expect(payload.retryAfterSec).toBe(60)
    expect(payload.rawSignalQueueId).toBe('q-fred-1')
  })

  it('writes timeout error row when fetch aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    const result = await fredMacroRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      timeoutMs: number
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('timeout')
    expect(payload.provider).toBe('fred')
    expect(payload.timeoutMs).toBe(15_000)
    expect(payload.rawSignalQueueId).toBe('q-fred-1')
  })

  it('writes external_api_error with statusCode when FRED returns 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    )
    const result = await fredMacroRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      statusCode: number
    }
    expect(payload.errorType).toBe('external_api_error')
    expect(payload.provider).toBe('fred')
    expect(payload.statusCode).toBe(503)
  })

  it('writes parse_error when FRED returns 200 with unexpected JSON shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ unexpected: 'shape' }),
      }),
    )
    const result = await fredMacroRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
    }
    expect(payload.errorType).toBe('parse_error')
    expect(payload.provider).toBe('fred')
  })

  it('environmental_event category pulls DCOILWTICO and DHHNGSP series', async () => {
    vi.stubGlobal('fetch', mockAllSeriesHealthy())
    const result = await fredMacroRunner(
      makeCtx({ signalCategory: 'environmental_event' }),
    )
    expect(result!.confidenceLevel).toBe('high')
    const payload = result!.rawContent as {
      series: Array<{ seriesId: string }>
    }
    expect(payload.series.some((s) => s.seriesId === 'DCOILWTICO')).toBe(true)
    expect(payload.series.some((s) => s.seriesId === 'DHHNGSP')).toBe(true)
  })

  it('raises divergenceFlag when a series latest value is > 2σ from trailing 3-month mean', async () => {
    // FEDFUNDS latest 10, trailing 3-mo mean ~5, sigma small → huge z-score.
    // Others stable (100).
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const match = url.match(/[?&]series_id=([^&]+)/)
      const seriesId = match ? decodeURIComponent(match[1]) : 'UNKNOWN'
      if (seriesId === 'FEDFUNDS') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve(
              buildObservations(10, { yearAgo: 5, tail: [5.0, 5.01, 4.99] }),
            ),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(buildObservations(100, { yearAgo: 95 })),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fredMacroRunner(makeCtx())
    expect(result!.divergenceFlag).toBe(true)
    expect(result!.divergenceDescription).toBeTruthy()
    expect(result!.divergenceDescription!.toUpperCase()).toContain('FEDFUNDS')
  })
})
