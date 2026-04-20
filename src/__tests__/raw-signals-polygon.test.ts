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
})
