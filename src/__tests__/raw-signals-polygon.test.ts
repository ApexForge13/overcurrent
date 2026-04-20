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
      errorType: string
      message: string
      context?: Record<string, unknown>
    }
    expect(payload.errorType).toBe('prisma_query_failed')
    expect(payload.message).toContain('DB connection lost')
    expect(payload.context).toBeDefined()
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
  })
})
