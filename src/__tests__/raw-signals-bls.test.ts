import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { blsRunner } from '@/lib/raw-signals/integrations/bls'
import type { RunnerContext } from '@/lib/raw-signals/runner'

// Fixed "today" — deterministic month/year stamping avoids drift flakiness.
const TODAY = new Date('2026-04-15T12:00:00Z')

function makeCtx(overrides?: Partial<RunnerContext['cluster']>): RunnerContext {
  return {
    queueId: 'q-bls-1',
    storyClusterId: 'cluster-bls-1',
    umbrellaArcId: null,
    // SignalType is strongly typed; bls_economic isn't in the union yet
    // (registry wiring is out of scope for this adapter pivot). Re-use
    // fred_macro as a placeholder — the adapter itself never reads this
    // field. Registry wiring will add bls_economic in a later pass.
    signalType: 'fred_macro',
    triggerLayer: 'category_trigger',
    triggerReason: 'always_on_macro',
    approvedByAdmin: false,
    cluster: {
      id: 'cluster-bls-1',
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
 * Build a BLS-shaped series payload with N observations, newest-first.
 * BLS returns monthly data keyed by year + period (M01..M12); values are
 * strings. Pattern mirrors buildObservations in the FRED test — latest at
 * index 0; optional tail array backfills indices 1..tail.length.
 */
function buildBlsSeries(
  seriesID: string,
  latest: number,
  opts?: { yearAgo?: number; tail?: number[] },
): {
  seriesID: string
  data: Array<{
    year: string
    period: string
    periodName: string
    value: string
    footnotes: Array<{ code: string; text: string }>
  }>
} {
  const data: Array<{
    year: string
    period: string
    periodName: string
    value: string
    footnotes: Array<{ code: string; text: string }>
  }> = []
  // 30 monthly observations going backwards from TODAY. Index 0 = newest.
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - i, 1))
    const year = String(d.getUTCFullYear())
    const monthNum = d.getUTCMonth() + 1
    const period = `M${String(monthNum).padStart(2, '0')}`
    const periodName = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ][d.getUTCMonth()]
    let v: number
    if (i === 0) v = latest
    else if (opts?.tail && i >= 1 && i <= opts.tail.length) v = opts.tail[i - 1]
    else if (opts?.yearAgo && i === 29) v = opts.yearAgo
    else v = latest
    data.push({
      year,
      period,
      periodName,
      value: String(v),
      footnotes: [{ code: '', text: '' }],
    })
  }
  return { seriesID, data }
}

/**
 * Mock fetch helper that inspects the POST body, reads the requested
 * seriesid array, and returns a healthy Results.series payload for each.
 * The returned mock also records calls so tests can assert on the body.
 */
function mockAllSeriesHealthy(perSeriesLatest?: Record<string, number>) {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const seriesIds: string[] = Array.isArray(body.seriesid) ? body.seriesid : []
    const series = seriesIds.map((sid) =>
      buildBlsSeries(sid, perSeriesLatest?.[sid] ?? 100, {
        yearAgo: (perSeriesLatest?.[sid] ?? 100) * 0.95,
      }),
    )
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          status: 'REQUEST_SUCCEEDED',
          responseTime: 42,
          message: [],
          Results: { series },
        }),
    })
  })
}

describe('blsRunner', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.BLS_API_KEY
    process.env.BLS_API_KEY = 'bls_test_key'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.BLS_API_KEY
    else process.env.BLS_API_KEY = originalKey
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns high confidence with 4 series when all default series succeed', async () => {
    const fetchMock = mockAllSeriesHealthy()
    vi.stubGlobal('fetch', fetchMock)
    const result = await blsRunner(makeCtx())
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('bls')
    expect(result!.confidenceLevel).toBe('high')
    const payload = result!.rawContent as {
      series: Array<{
        seriesId: string
        observations: Array<{ date: string; value: number | null }>
        latest: number | null
        lookbackPctChange: number | null
        trailingSigma12Obs: number | null
      }>
    }
    expect(payload.series).toHaveLength(4)
    for (const s of payload.series) {
      expect(s.seriesId).toBeDefined()
      expect(Array.isArray(s.observations)).toBe(true)
      expect(s.observations.length).toBeGreaterThanOrEqual(12)
      expect('latest' in s).toBe(true)
      expect('lookbackPctChange' in s).toBe(true)
      expect('trailingSigma12Obs' in s).toBe(true)
    }
    // Body assertions: POST went out with the 4 default series IDs and
    // registrationkey=bls_test_key.
    expect(fetchMock).toHaveBeenCalled()
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body.seriesid).toEqual(
      expect.arrayContaining(['LNS14000000', 'CES0000000001', 'CWUR0000SA0', 'PRS85006092']),
    )
    expect(body.registrationkey).toBe('bls_test_key')
  })

  // BLS-specific nuance: missing BLS_API_KEY is NOT auth_failed — the API
  // is callable anonymously (25/day quota). Absence only bites when the
  // anonymous quota is exhausted, at which point BLS returns 400 with a
  // "daily threshold for requests" body. That routes to rate_limited.
  // Contrast with FRED, where missing FRED_API_KEY is hard auth_failed
  // (the API refuses unauthenticated requests outright).
  it('routes missing-key + quota-exhaust to rate_limited (not auth_failed)', async () => {
    delete process.env.BLS_API_KEY
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            status: 'REQUEST_NOT_PROCESSED',
            message: [
              'REQUEST_NOT_PROCESSED: Your request exceeded the daily threshold for requests.',
            ],
            Results: {},
          }),
      }),
    )
    const result = await blsRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorVersion: number
      errorType: string
      provider: string
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('rate_limited')
    expect(payload.provider).toBe('bls')
    expect(payload.rawSignalQueueId).toBe('q-bls-1')
  })

  it('routes 400 with quota-exhaust body to rate_limited (key present)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            status: 'REQUEST_NOT_PROCESSED',
            message: [
              'REQUEST_NOT_PROCESSED: Your request exceeded the daily threshold for requests.',
            ],
            Results: {},
          }),
      }),
    )
    const result = await blsRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('rate_limited')
    expect(payload.provider).toBe('bls')
    expect(payload.rawSignalQueueId).toBe('q-bls-1')
  })

  it('routes 400 with non-quota body to external_api_error (statusCode 400)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            status: 'REQUEST_NOT_PROCESSED',
            message: ['REQUEST_NOT_PROCESSED: Invalid seriesID: BAD_SERIES.'],
            Results: {},
          }),
      }),
    )
    const result = await blsRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      statusCode?: number
      message: string
    }
    expect(payload.errorType).toBe('external_api_error')
    expect(payload.provider).toBe('bls')
    expect(payload.statusCode).toBe(400)
    expect(payload.message).toMatch(/Invalid seriesID/i)
  })

  it('writes timeout error row when fetch aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    const result = await blsRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      timeoutMs: number
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('timeout')
    expect(payload.provider).toBe('bls')
    expect(payload.timeoutMs).toBe(15_000)
    expect(payload.rawSignalQueueId).toBe('q-bls-1')
  })

  it('writes external_api_error with statusCode when BLS returns 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    )
    const result = await blsRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      statusCode: number
    }
    expect(payload.errorType).toBe('external_api_error')
    expect(payload.provider).toBe('bls')
    expect(payload.statusCode).toBe(503)
  })

  it('writes parse_error when BLS returns 200 with unexpected JSON shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({ unexpected: 'shape', status: 'REQUEST_SUCCEEDED' }),
      }),
    )
    const result = await blsRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
    }
    expect(payload.errorType).toBe('parse_error')
    expect(payload.provider).toBe('bls')
  })

  it('raises divergenceFlag when a series latest value is > 2σ from trailing 12-observation mean', async () => {
    // LNS14000000 latest 15.0 against a trailing-12 cluster near 3.5 with
    // tiny jitter → huge |z|. Other series flat at 100.
    const UNRATE_TAIL = [
      3.5, 3.51, 3.49, 3.52, 3.48, 3.5, 3.51, 3.49, 3.5, 3.52, 3.48, 3.5,
    ]
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const seriesIds: string[] = Array.isArray(body.seriesid) ? body.seriesid : []
      const series = seriesIds.map((sid) => {
        if (sid === 'LNS14000000') {
          return buildBlsSeries(sid, 15.0, { yearAgo: 4.0, tail: UNRATE_TAIL })
        }
        return buildBlsSeries(sid, 100, { yearAgo: 95 })
      })
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            status: 'REQUEST_SUCCEEDED',
            responseTime: 42,
            message: [],
            Results: { series },
          }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await blsRunner(makeCtx())
    expect(result!.divergenceFlag).toBe(true)
    expect(result!.divergenceDescription).toBeTruthy()
    expect(result!.divergenceDescription!.toUpperCase()).toContain('LNS14000000')
  })
})
