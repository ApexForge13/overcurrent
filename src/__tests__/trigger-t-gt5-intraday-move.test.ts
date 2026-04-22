import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/raw-signals/clients/polygon-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/polygon-client')
  >('@/lib/raw-signals/clients/polygon-client')
  return { ...actual, fetchSnapshot: vi.fn() }
})

import { priceIntradayMoveTrigger } from '@/lib/gap-score/triggers/ground-truth/price-intraday-move'
import { fetchSnapshot } from '@/lib/raw-signals/clients/polygon-client'

const fetchMock = vi.mocked(fetchSnapshot)

function ctx(opts: {
  entities?: Array<{ id: string; identifier: string; category: string }>
  baselines?: Array<{ entityId: string; stddev: number }>
  firedToday?: Array<{ entityId: string }>
  thresholds?: Record<string, number>
}): TriggerContext {
  return {
    now: new Date('2026-04-22T18:00:00Z'),
    thresholds: opts.thresholds,
    prisma: {
      trackedEntity: { findMany: vi.fn().mockResolvedValue(opts.entities ?? []) },
      entityBaseline: { findMany: vi.fn().mockResolvedValue(opts.baselines ?? []) },
      triggerEvent: { findMany: vi.fn().mockResolvedValue(opts.firedToday ?? []) },
      costLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-GT5 intraday price move', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    process.env.POLYGON_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.POLYGON_API_KEY
  })

  it('fires when move exceeds equity threshold 3% + baseline mature', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', lastPrice: 103.5, prevClose: 100, dayOpen: 100.5, todaysChangePerc: 3.5, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }], // 2% daily vol
      }),
    )
    expect(fires).toHaveLength(1)
    // move = 3.5%, stddev = 2%, severity = 3.5/2 = 1.75 → cap 1.0
    expect(fires[0].severity).toBe(1.0)
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
  })

  it('does NOT fire when move below threshold (2% on equity)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', lastPrice: 102, prevClose: 100, dayOpen: 101, todaysChangePerc: 2, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('crypto threshold is 5% (higher than equity)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'X:BTCUSD', lastPrice: 104, prevClose: 100, dayOpen: 101, todaysChangePerc: 4, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-btc', identifier: 'BTC', category: 'crypto' }],
        baselines: [{ entityId: 'e-btc', stddev: 0.05 }],
      }),
    )
    // 4% move < 5% crypto threshold → no fire
    expect(fires).toHaveLength(0)
  })

  it('direction -1 on negative move', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', lastPrice: 95, prevClose: 100, dayOpen: 98, todaysChangePerc: -5, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
      }),
    )
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
  })

  it('respects threshold overrides from TriggerContext', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', lastPrice: 103, prevClose: 100, dayOpen: 101, todaysChangePerc: 3, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
        thresholds: { intraday_equity_pct: 0.05 }, // override to 5%
      }),
    )
    // 3% < override 5% → no fire
    expect(fires).toHaveLength(0)
  })

  it('skips entities with immature baseline', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', lastPrice: 110, prevClose: 100, dayOpen: 101, todaysChangePerc: 10, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [], // baseline not yet mature
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('writes missing-key heartbeat when POLYGON_API_KEY absent', async () => {
    delete process.env.POLYGON_API_KEY
    const c = ctx({})
    const fires = await priceIntradayMoveTrigger(c)
    expect(fires).toEqual([])
    expect(c.prisma.costLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalled()
  })

  it('dedupes — entity already fired today is skipped', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', lastPrice: 110, prevClose: 100, dayOpen: 101, todaysChangePerc: 10, updated: 1 },
    })
    const fires = await priceIntradayMoveTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
        firedToday: [{ entityId: 'e-aapl' }],
      }),
    )
    expect(fires).toHaveLength(0)
  })
})
