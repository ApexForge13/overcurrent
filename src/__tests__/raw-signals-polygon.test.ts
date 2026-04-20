import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { polygonRunner } from '@/lib/raw-signals/integrations/polygon'
import type { RunnerContext } from '@/lib/raw-signals/runner'

const baseCtx: RunnerContext = {
  queueId: 'q1',
  storyClusterId: 'cluster1',
  umbrellaArcId: null,
  signalType: 'financial_equity',
  triggerLayer: 'category_trigger',
  triggerReason: 'always_on_financial',
  approvedByAdmin: false,
  cluster: {
    id: 'cluster1',
    headline: 'Test cluster',
    synopsis: 'Test synopsis',
    firstDetectedAt: new Date('2026-04-15T12:00:00Z'),
    entities: ['Apple Inc'],
    signalCategory: 'corporate_scandal',
  },
}

describe('polygonRunner', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.POLYGON_API_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.POLYGON_API_KEY
    else process.env.POLYGON_API_KEY = originalKey
    vi.restoreAllMocks()
  })

  it('writes unavailable row when POLYGON_API_KEY is absent', async () => {
    delete process.env.POLYGON_API_KEY
    const result = await polygonRunner(baseCtx)
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('polygon')
    expect(result!.confidenceLevel).toBe('unavailable')
    expect(result!.divergenceFlag).toBe(false)
    expect(result!.haikuSummary).toMatch(/Polygon.*not.*provisioned/i)
  })

  it('writes unavailable row when no entities resolve to tickers', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([])

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable')
    expect(result!.haikuSummary).toMatch(/no equity-tradable entities/i)
    expect((result!.rawContent as Record<string, unknown>).resolvedTickers).toEqual([])
  })

  it('writes unavailable row when ticker resolution throws', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockRejectedValue(
      new Error('DB connection lost'),
    )

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable')
    expect(result!.haikuSummary).toMatch(/ticker resolution failed/i)
    const payload = result!.rawContent as {
      errorVersion: number
      errorType: string
      message: string
      rawSignalQueueId?: string
      clusterEntities?: string[]
      prismaCode?: string
    }
    expect(payload.errorVersion).toBe(1)
    expect(payload.errorType).toBe('prisma_query_failed')
    expect(payload.message).toContain('DB connection lost')
    expect(payload.rawSignalQueueId).toBe('q1')  // baseCtx has queueId: 'q1'
    expect(Array.isArray(payload.clusterEntities)).toBe(true)
  })

  it('fetches EOD + snapshot + reference per ticker and writes high-confidence row when all endpoints succeed', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entity: { name: 'Apple Inc' } } as never,
    ])
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v2/aggs/ticker/AAPL/prev')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              results: [{ c: 175.5, o: 170.0, h: 176.0, l: 169.0, v: 50_000_000, t: 1734000000000 }],
            }),
        })
      }
      if (url.includes('/v2/snapshot/locale/us/markets/stocks/tickers/AAPL')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ticker: { lastQuote: { p: 176.1, P: 176.2 }, lastTrade: { p: 176.0 } } }),
        })
      }
      if (url.includes('/v3/reference/tickers/AAPL')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              results: { name: 'Apple Inc.', sic_description: 'Electronic Computers', market_cap: 2_700_000_000_000, primary_exchange: 'XNAS' },
            }),
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await polygonRunner(baseCtx)
    expect(result!.signalSource).toBe('polygon')
    expect(result!.confidenceLevel).toBe('high')
    const payload = result!.rawContent as { tickers: Array<{ ticker: string; eod?: unknown; snapshot?: unknown; reference?: unknown; errors: string[] }> }
    expect(payload.tickers).toHaveLength(1)
    expect(payload.tickers[0].ticker).toBe('AAPL')
    expect(payload.tickers[0].eod).toBeDefined()
    expect(payload.tickers[0].snapshot).toBeDefined()
    expect(payload.tickers[0].reference).toBeDefined()
    expect(payload.tickers[0].errors).toEqual([])

    // Credential hygiene: key must travel via Authorization header, not URL query.
    // Leaked ?apiKey=... shows up in Vercel access logs, LB logs, and error-tracker payloads.
    const allCalls = fetchMock.mock.calls
    expect(allCalls.length).toBeGreaterThanOrEqual(3)
    for (const call of allCalls) {
      const init = call[1] as RequestInit | undefined
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.Authorization).toBe('Bearer pk_test')
    }
    for (const call of allCalls) {
      expect(call[0]).not.toContain('apiKey=')
    }
  })

  it('writes medium confidence when EOD succeeds but snapshot + reference fail', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entity: { name: 'Apple Inc' } } as never,
    ])
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v2/aggs/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [{ c: 175, o: 170, h: 176, l: 169, v: 1, t: 1 }] }),
        })
      }
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    }))

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('medium')
    const tickers = (result!.rawContent as { tickers: Array<{ errors: string[] }> }).tickers
    expect(tickers[0].errors).toEqual(expect.arrayContaining(['snapshot_status_5xx', 'reference_status_5xx']))
    expect(tickers[0].errors.every((e) => !e.startsWith('eod_'))).toBe(true)
  })

  it('writes unavailable when ticker is not in Polygon universe (all 3 return 404)', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'NOPE', entity: { name: 'Nonexistent Inc' } } as never,
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) }))

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable')
    const tickers = (result!.rawContent as { tickers: Array<{ errors: string[] }> }).tickers
    expect(tickers[0].errors).toEqual([
      'eod_status_404',
      'snapshot_status_404',
      'reference_status_404',
    ])
  })

  it('writes unavailable when fetch throws on every endpoint (network failure)', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entity: { name: 'Apple Inc' } } as never,
    ])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable')
    const tickers = (result!.rawContent as { tickers: Array<{ errors: string[] }> }).tickers
    // classifyCaughtError returns 'network' for ECONNRESET-style errors
    expect(tickers[0].errors).toEqual([
      'eod_network',
      'snapshot_network',
      'reference_network',
    ])
  })

  it('correctly constructs URLs for dotted tickers like BRK.A class shares', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'BRK.A', entity: { name: 'Berkshire Hathaway Inc' } } as never,
    ])
    const fetchMock = vi.fn().mockImplementation((_url: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results: [{ c: 600000, o: 599000, h: 601000, l: 598000, v: 100, t: 1 }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await polygonRunner(baseCtx)

    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    // Polygon accepts literal dots in path segments (RFC 3986 unreserved).
    // Confirm our encoding preserves the dot exactly — not encoded as %2E.
    expect(urls.some((u) => u.includes('/v2/aggs/ticker/BRK.A/prev'))).toBe(true)
    expect(urls.some((u) => u.includes('/v2/snapshot/locale/us/markets/stocks/tickers/BRK.A'))).toBe(true)
    expect(urls.some((u) => u.includes('/v3/reference/tickers/BRK.A'))).toBe(true)
    // Negative assertion: no percent-encoded dot variants
    for (const u of urls) {
      expect(u).not.toContain('BRK%2EA')
    }
  })
})
