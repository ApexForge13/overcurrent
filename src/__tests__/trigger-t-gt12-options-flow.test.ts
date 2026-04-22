import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import type { PolygonOptionContract } from '@/lib/raw-signals/clients/polygon-client'

vi.mock('@/lib/raw-signals/clients/polygon-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/polygon-client')
  >('@/lib/raw-signals/clients/polygon-client')
  return { ...actual, fetchOptionsChain: vi.fn() }
})

import {
  optionsFlowUnusualTrigger,
  optionsFlowSeverity,
} from '@/lib/gap-score/triggers/ground-truth/options-flow-unusual'
import { fetchOptionsChain } from '@/lib/raw-signals/clients/polygon-client'

const fetchMock = vi.mocked(fetchOptionsChain)

function ctx(opts: {
  entities?: Array<{ id: string; identifier: string; category: string }>
  firedToday?: Array<{ entityId: string }>
}): TriggerContext {
  return {
    now: new Date('2026-04-22T18:00:00Z'),
    prisma: {
      trackedEntity: { findMany: vi.fn().mockResolvedValue(opts.entities ?? []) },
      triggerEvent: { findMany: vi.fn().mockResolvedValue(opts.firedToday ?? []) },
      costLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

function makeContract(type: 'call' | 'put', volume: number, openInterest: number, strike = 100): PolygonOptionContract {
  return {
    contract: `O:TEST260515${type === 'call' ? 'C' : 'P'}00${strike}000`,
    underlying: 'TEST',
    expiration: '2026-05-15',
    strike,
    type,
    dayVolume: volume,
    openInterest,
    impliedVolatility: 0.35,
    lastPrice: 1.50,
  }
}

describe('T-GT12 options flow', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    process.env.POLYGON_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.POLYGON_API_KEY
  })

  it('optionsFlowSeverity: 2x→0.4, 5x→0.8, 10x+→1.0', () => {
    expect(optionsFlowSeverity(1.5)).toBe(0)
    expect(optionsFlowSeverity(2)).toBeCloseTo(0.4, 2)
    expect(optionsFlowSeverity(5)).toBeCloseTo(0.8, 2)
    expect(optionsFlowSeverity(10)).toBe(1.0)
    expect(optionsFlowSeverity(20)).toBe(1.0)
  })

  it('fires on 3x+ volume/OI ratio, call-dominant → direction +1', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: [
        makeContract('call', 3000, 1000), // 3x ratio
        makeContract('call', 2500, 1000, 95),
        makeContract('put', 600, 1000),
      ],
    })
    const fires = await optionsFlowUnusualTrigger(
      ctx({ entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }] }),
    )
    expect(fires).toHaveLength(1)
    // dominant ratio = 3, severity interpolated
    expect(fires[0].severity).toBeCloseTo(0.533, 2)
    const md = fires[0].metadata as { direction: number; dominant_type: string }
    expect(md.direction).toBe(1)
    expect(md.dominant_type).toBe('call')
  })

  it('put-dominant → direction -1', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: [
        makeContract('put', 5000, 800),
        makeContract('call', 600, 1000),
      ],
    })
    const fires = await optionsFlowUnusualTrigger(
      ctx({ entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }] }),
    )
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
  })

  it('no fire when all contracts are below unusual threshold', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: [
        makeContract('call', 800, 1000), // 0.8x ratio
        makeContract('put', 500, 1000),
      ],
    })
    const fires = await optionsFlowUnusualTrigger(
      ctx({ entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }] }),
    )
    expect(fires).toHaveLength(0)
  })

  it('filters out low-volume contracts (<500 vol or <50 OI)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: [
        makeContract('call', 400, 10), // below vol floor, below OI floor
        makeContract('call', 200, 50),
      ],
    })
    const fires = await optionsFlowUnusualTrigger(
      ctx({ entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }] }),
    )
    expect(fires).toHaveLength(0)
  })

  it('writes missing-key heartbeat + skips when POLYGON_API_KEY absent', async () => {
    delete process.env.POLYGON_API_KEY
    const c = ctx({ entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }] })
    const fires = await optionsFlowUnusualTrigger(c)
    expect(fires).toEqual([])
    expect(c.prisma.costLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalled()
  })

  it('dedupes by entity fired today', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: [makeContract('call', 5000, 500)], // 10x ratio, would fire at severity 1.0
    })
    const fires = await optionsFlowUnusualTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        firedToday: [{ entityId: 'e-aapl' }],
      }),
    )
    expect(fires).toHaveLength(0)
  })
})
