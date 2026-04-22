import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import type { CotRow } from '@/lib/raw-signals/integrations/cftc-cot'

vi.mock('@/lib/raw-signals/integrations/cftc-cot', () => ({
  fetchLatestCotReport: vi.fn(),
  upsertCotRows: vi.fn().mockResolvedValue({ upserted: 0 }),
}))

import { cftcManagedMoneyTrigger, cftcSeverityFromDelta } from '@/lib/gap-score/triggers/ground-truth/cftc-managed-money'
import { fetchLatestCotReport } from '@/lib/raw-signals/integrations/cftc-cot'

const fetchMock = vi.mocked(fetchLatestCotReport)

function mockPrisma(opts: {
  rows: CotRow[]
  entityId?: string
  recentPositions?: Array<{ reportDate: Date; managedMoneyNetPct: number }>
  existingFire?: boolean
}): TriggerContext['prisma'] {
  return {
    cftcPosition: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue(opts.recentPositions ?? []),
    },
    trackedEntity: {
      findUnique: vi.fn().mockResolvedValue(opts.entityId ? { id: opts.entityId } : null),
    },
    triggerEvent: {
      findFirst: vi.fn().mockResolvedValue(opts.existingFire ? { id: 'ex1' } : null),
    },
    costLog: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as TriggerContext['prisma']
}

function ctx(p: TriggerContext['prisma']): TriggerContext {
  return { prisma: p, now: new Date('2026-04-22T18:00:00Z') }
}

function makeRow(netPct: number, reportDate = new Date('2026-04-15T00:00:00Z')): CotRow {
  return {
    marketCode: '067651', exchangeCode: 'NYMEX', marketName: 'WTI',
    reportDate, managedMoneyLongPct: Math.max(0, netPct) + 0.05,
    managedMoneyShortPct: Math.max(0, -netPct) + 0.05,
    managedMoneyNetPct: netPct,
    producerNetPct: null, swapDealerNetPct: null,
    openInterestTotal: 2_000_000,
  }
}

describe('T-GT4 CFTC managed money delta', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('cftcSeverityFromDelta follows the log ladder', () => {
    expect(cftcSeverityFromDelta(0)).toBe(0)
    expect(cftcSeverityFromDelta(0.10)).toBeCloseTo(0.4, 2)
    expect(cftcSeverityFromDelta(0.25)).toBeCloseTo(0.8, 2)
    expect(cftcSeverityFromDelta(0.50)).toBe(1.0)
    expect(cftcSeverityFromDelta(0.75)).toBe(1.0) // above cap
  })

  it('writes no_data heartbeat when COT fetch returns empty', async () => {
    fetchMock.mockResolvedValueOnce([])
    const p = mockPrisma({ rows: [] })
    const fires = await cftcManagedMoneyTrigger(ctx(p))
    expect(fires).toEqual([])
    const create = p.costLog.create as ReturnType<typeof vi.fn>
    const md = (create.mock.calls[0][0] as { data: { metadata: { outcome: string } } }).data.metadata
    expect(md.outcome).toBe('no_data')
  })

  it('fires when delta > 10% with correct severity + direction', async () => {
    fetchMock.mockResolvedValueOnce([makeRow(0.25)])
    const p = mockPrisma({
      rows: [makeRow(0.25)],
      entityId: 'e-cl',
      recentPositions: [
        { reportDate: new Date('2026-04-15T00:00:00Z'), managedMoneyNetPct: 0.25 },
        { reportDate: new Date('2026-04-08T00:00:00Z'), managedMoneyNetPct: 0.10 },
      ],
    })
    const fires = await cftcManagedMoneyTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    // delta = 0.15, interpolated between 0.10→0.4 and 0.25→0.8
    // frac = (0.15 - 0.10) / 0.15 = 0.333..., severity = 0.4 + 0.333 × 0.4 = 0.533
    expect(fires[0].severity).toBeCloseTo(0.533, 2)
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
  })

  it('does NOT fire when delta < 10%', async () => {
    fetchMock.mockResolvedValueOnce([makeRow(0.15)])
    const p = mockPrisma({
      rows: [makeRow(0.15)],
      entityId: 'e-cl',
      recentPositions: [
        { reportDate: new Date('2026-04-15'), managedMoneyNetPct: 0.15 },
        { reportDate: new Date('2026-04-08'), managedMoneyNetPct: 0.10 }, // only +5%
      ],
    })
    const fires = await cftcManagedMoneyTrigger(ctx(p))
    expect(fires).toHaveLength(0)
  })

  it('direction -1 when managed money net decreases', async () => {
    fetchMock.mockResolvedValueOnce([makeRow(-0.05)])
    const p = mockPrisma({
      rows: [makeRow(-0.05)],
      entityId: 'e-cl',
      recentPositions: [
        { reportDate: new Date('2026-04-15'), managedMoneyNetPct: -0.05 },
        { reportDate: new Date('2026-04-08'), managedMoneyNetPct: 0.15 }, // -20% delta
      ],
    })
    const fires = await cftcManagedMoneyTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
  })

  it('logs unmapped CFTC codes to CostLog', async () => {
    // Use a market code not in CFTC_MARKET_MAP
    const unknownRow = { ...makeRow(0.3), marketCode: '999999' }
    fetchMock.mockResolvedValueOnce([unknownRow])
    const p = mockPrisma({ rows: [unknownRow] })
    await cftcManagedMoneyTrigger(ctx(p))
    const createMany = p.costLog.createMany as ReturnType<typeof vi.fn>
    expect(createMany).toHaveBeenCalled()
    const data = (createMany.mock.calls[0][0] as { data: Array<{ operation: string }> }).data
    expect(data[0].operation).toBe('cftc-unmapped-market')
  })

  it('dedupes — does NOT re-fire when T-GT4 already exists for (entity, reportDate)', async () => {
    fetchMock.mockResolvedValueOnce([makeRow(0.30)])
    const p = mockPrisma({
      rows: [makeRow(0.30)],
      entityId: 'e-cl',
      recentPositions: [
        { reportDate: new Date('2026-04-15'), managedMoneyNetPct: 0.30 },
        { reportDate: new Date('2026-04-08'), managedMoneyNetPct: 0.10 },
      ],
      existingFire: true,
    })
    const fires = await cftcManagedMoneyTrigger(ctx(p))
    expect(fires).toHaveLength(0)
  })
})
