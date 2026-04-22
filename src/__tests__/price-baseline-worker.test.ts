import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/raw-signals/clients/polygon-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/polygon-client')
  >('@/lib/raw-signals/clients/polygon-client')
  return { ...actual, fetchDailyBars: vi.fn() }
})

import {
  recomputePriceBaselines,
  computeRealizedVolatility,
  mapIdentifierToPolygonTicker,
} from '@/lib/gap-score/triggers/ground-truth/price-baseline-worker'
import { fetchDailyBars } from '@/lib/raw-signals/clients/polygon-client'

const fetchMock = vi.mocked(fetchDailyBars)

function makePrisma(entities: Array<{ id: string; identifier: string; category: string }>, existingIsMature?: boolean): PrismaClient {
  return {
    trackedEntity: {
      findMany: vi.fn().mockResolvedValue(entities),
    },
    entityBaseline: {
      findUnique: vi.fn().mockResolvedValue(existingIsMature === undefined ? null : { isMature: existingIsMature }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    costLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('price baseline worker', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    process.env.POLYGON_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.POLYGON_API_KEY
  })

  it('computeRealizedVolatility: log-return stddev', () => {
    // Prices: 100, 101, 102.01 (roughly 1% daily growth each step)
    const bars = [
      { close: 100 },
      { close: 101 },
      { close: 102.01 },
    ]
    const stats = computeRealizedVolatility(bars)
    expect(stats.sampleCount).toBe(2)
    // Both log returns ≈ 0.00995, stddev ≈ 0 (perfectly trending)
    expect(stats.stddev).toBeLessThan(0.0001)
  })

  it('computeRealizedVolatility: non-trivial volatility series', () => {
    const bars = [
      { close: 100 },
      { close: 110 },  // +10%
      { close: 99 },   // -10%
      { close: 108 },  // +9%
    ]
    const stats = computeRealizedVolatility(bars)
    expect(stats.sampleCount).toBe(3)
    expect(stats.stddev).toBeGreaterThan(0.05) // high vol
  })

  it('computeRealizedVolatility: empty or degenerate returns { 0, 0, 0 }', () => {
    expect(computeRealizedVolatility([])).toEqual({ stddev: 0, mean: 0, sampleCount: 0 })
    expect(computeRealizedVolatility([{ close: 100 }])).toEqual({ stddev: 0, mean: 0, sampleCount: 0 })
    // Zero-close rejection
    const s = computeRealizedVolatility([{ close: 0 }, { close: 100 }])
    expect(s.sampleCount).toBe(0)
  })

  it('mapIdentifierToPolygonTicker', () => {
    expect(mapIdentifierToPolygonTicker('AAPL', 'equity')).toBe('AAPL')
    expect(mapIdentifierToPolygonTicker('SPY', 'etf')).toBe('SPY')
    expect(mapIdentifierToPolygonTicker('BTC', 'crypto')).toBe('X:BTCUSD')
    expect(mapIdentifierToPolygonTicker('CL=F', 'commodity')).toBeNull()
    expect(mapIdentifierToPolygonTicker('DGS10', 'yield')).toBeNull()
  })

  it('writes missing-key heartbeat when POLYGON_API_KEY absent', async () => {
    delete process.env.POLYGON_API_KEY
    const prisma = makePrisma([])
    const result = await recomputePriceBaselines(prisma)
    expect(result.keyMissing).toBe(true)
    expect(result.baselinesUpserted).toBe(0)
    expect(prisma.costLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalled()
  })

  it('upserts baseline after fetching bars', async () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      open: 100, high: 102, low: 99, close: 100 + i * 0.5, volume: 1000, ts: i,
    }))
    fetchMock.mockResolvedValue({ ok: true, value: bars })
    const prisma = makePrisma([{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }])
    const result = await recomputePriceBaselines(prisma)
    expect(result.entitiesEvaluated).toBe(1)
    expect(result.baselinesUpserted).toBe(1)
    expect(result.maturityFlipped).toBe(1) // 29 returns > 25 threshold
  })

  it('isMature=false when <25 bars returned', async () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({
      open: 100, high: 102, low: 99, close: 100 + i * 0.5, volume: 1000, ts: i,
    }))
    fetchMock.mockResolvedValue({ ok: true, value: bars })
    const prisma = makePrisma([{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }])
    const result = await recomputePriceBaselines(prisma)
    expect(result.maturityFlipped).toBe(0)
    const upsert = prisma.entityBaseline.upsert as ReturnType<typeof vi.fn>
    const args = upsert.mock.calls[0][0] as { create: { isMature: boolean } }
    expect(args.create.isMature).toBe(false)
  })

  it('counts fetch errors without killing the batch', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, errorType: 'rate_limited' })
    fetchMock.mockResolvedValueOnce({ ok: true, value: Array.from({ length: 30 }, (_, i) => ({ open: 1, high: 1, low: 1, close: 100 + i, volume: 1, ts: i })) })
    const prisma = makePrisma([
      { id: 'e1', identifier: 'AAPL', category: 'equity' },
      { id: 'e2', identifier: 'MSFT', category: 'equity' },
    ])
    const result = await recomputePriceBaselines(prisma)
    expect(result.fetchErrors).toBe(1)
    expect(result.baselinesUpserted).toBe(1)
  })
})
