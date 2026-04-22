import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/raw-signals/clients/polygon-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/polygon-client')
  >('@/lib/raw-signals/clients/polygon-client')
  return { ...actual, fetchPreviousDayBar: vi.fn(), fetchDailyBars: vi.fn() }
})

import { priceOvernightGapTrigger } from '@/lib/gap-score/triggers/ground-truth/price-overnight-gap'
import { fetchPreviousDayBar, fetchDailyBars } from '@/lib/raw-signals/clients/polygon-client'

const prevMock = vi.mocked(fetchPreviousDayBar)
const dailyMock = vi.mocked(fetchDailyBars)

function ctx(opts: {
  entities?: Array<{ id: string; identifier: string; category: string }>
  baselines?: Array<{ entityId: string; stddev: number }>
  firedToday?: Array<{ entityId: string }>
}): TriggerContext {
  return {
    now: new Date('2026-04-22T14:30:00Z'),
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

const makeBar = (close: number, open = close) => ({ open, high: close + 1, low: close - 1, close, volume: 1000, ts: 1 })

describe('T-GT6 overnight gap', () => {
  beforeEach(() => {
    prevMock.mockReset()
    dailyMock.mockReset()
    process.env.POLYGON_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.POLYGON_API_KEY
  })

  it('fires when gap exceeds equity 2% threshold', async () => {
    prevMock.mockResolvedValue({ ok: true, value: makeBar(100) })
    dailyMock.mockResolvedValue({ ok: true, value: [makeBar(103, 103)] }) // open=103 → +3% gap
    const fires = await priceOvernightGapTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
      }),
    )
    expect(fires).toHaveLength(1)
    // gap = 3%, vol = 2%, severity = 1.5 → cap 1.0
    expect(fires[0].severity).toBe(1.0)
  })

  it('does NOT fire when gap below threshold', async () => {
    prevMock.mockResolvedValue({ ok: true, value: makeBar(100) })
    dailyMock.mockResolvedValue({ ok: true, value: [makeBar(101, 101)] }) // only 1% gap
    const fires = await priceOvernightGapTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('direction -1 on negative gap', async () => {
    prevMock.mockResolvedValue({ ok: true, value: makeBar(100) })
    dailyMock.mockResolvedValue({ ok: true, value: [makeBar(96, 96)] }) // -4% gap
    const fires = await priceOvernightGapTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [{ entityId: 'e-aapl', stddev: 0.02 }],
      }),
    )
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
  })

  it('skips entities with immature baseline', async () => {
    prevMock.mockResolvedValue({ ok: true, value: makeBar(100) })
    dailyMock.mockResolvedValue({ ok: true, value: [makeBar(110, 110)] })
    const fires = await priceOvernightGapTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL', category: 'equity' }],
        baselines: [], // not mature
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('writes heartbeat + skips when POLYGON_API_KEY absent', async () => {
    delete process.env.POLYGON_API_KEY
    const c = ctx({})
    const fires = await priceOvernightGapTrigger(c)
    expect(fires).toEqual([])
    expect(c.prisma.costLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalled()
  })
})
