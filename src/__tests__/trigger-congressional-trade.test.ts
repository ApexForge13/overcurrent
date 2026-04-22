import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import type { ScrapedPtrFiling } from '@/lib/raw-signals/integrations/congress-trade'

vi.mock('@/lib/raw-signals/integrations/congress-trade', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/integrations/congress-trade')
  >('@/lib/raw-signals/integrations/congress-trade')
  return {
    ...actual,
    fetchHousePtrs: vi.fn(),
    fetchSenatePtrs: vi.fn(),
  }
})

import { congressionalTradeTrigger } from '@/lib/gap-score/triggers/ground-truth/congressional-trade'
import {
  fetchHousePtrs,
  fetchSenatePtrs,
} from '@/lib/raw-signals/integrations/congress-trade'

const houseMock = vi.mocked(fetchHousePtrs)
const senateMock = vi.mocked(fetchSenatePtrs)

function makeFiling(overrides: Partial<ScrapedPtrFiling> & {
  ticker: string | null
  member: string
  chamber: 'house' | 'senate'
}): ScrapedPtrFiling {
  return {
    ticker: overrides.ticker,
    chamber: overrides.chamber,
    member: overrides.member,
    transactionType: overrides.transactionType ?? 'purchase',
    transactionDate: overrides.transactionDate ?? null,
    disclosedAt: overrides.disclosedAt ?? '2026-04-20T10:00:00Z',
    amountBucket: overrides.amountBucket ?? null,
    filingUrl: overrides.filingUrl ?? 'https://example.test/disclosure.pdf',
    disclosureId: overrides.disclosureId ?? 'd-1',
  }
}

function prisma(opts: {
  entities?: Array<{ id: string; identifier: string; subcategory: string | null }>
}): TriggerContext['prisma'] {
  return {
    trackedEntity: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { identifier?: { in: string[] } } }) => {
        const list = opts.entities ?? []
        if (where.identifier?.in) {
          const set = new Set(where.identifier.in.map((s) => s.toUpperCase()))
          return Promise.resolve(list.filter((e) => set.has(e.identifier.toUpperCase())))
        }
        return Promise.resolve(list)
      }),
    },
    triggerCursor: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    costLog: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as TriggerContext['prisma']
}

function ctx(p: TriggerContext['prisma']): TriggerContext {
  return { prisma: p, now: new Date('2026-04-21T12:00:00Z') }
}

describe('T-GT10 congressional trade', () => {
  beforeEach(() => {
    houseMock.mockReset()
    senateMock.mockReset()
    senateMock.mockResolvedValue({ filings: [], skippedRows: 0 })
  })

  it('writes an empty heartbeat when no filings found', async () => {
    houseMock.mockResolvedValueOnce({ filings: [], skippedRows: 0 })
    const p = prisma({})
    const fires = await congressionalTradeTrigger(ctx(p))
    expect(fires).toEqual([])
    const heartbeats = (p.costLog.create as ReturnType<typeof vi.fn>).mock.calls
    expect(heartbeats).toHaveLength(1)
    expect((heartbeats[0][0] as { data: { metadata: { outcome: string } } }).data.metadata.outcome).toBe('empty')
  })

  it('writes a failure heartbeat when scraper throws', async () => {
    houseMock.mockRejectedValueOnce(new Error('network timeout'))
    const p = prisma({})
    await congressionalTradeTrigger(ctx(p))
    const calls = (p.costLog.create as ReturnType<typeof vi.fn>).mock.calls
    const first = calls[0][0] as { data: { metadata: { outcome: string; errors: string[] } } }
    expect(first.data.metadata.outcome).toBe('failure')
    expect(first.data.metadata.errors[0]).toContain('network timeout')
  })

  it('fires base severity 0.4 for a single low-amount disclosure on tracked ticker', async () => {
    houseMock.mockResolvedValueOnce({
      filings: [
        makeFiling({
          ticker: 'AAPL',
          member: 'Pelosi',
          chamber: 'house',
          transactionType: 'purchase',
          amountBucket: { low: 1001, high: 15000, raw: '$1,001 - $15,000' },
        }),
      ],
      skippedRows: 0,
    })
    const p = prisma({ entities: [{ id: 'ent-aapl', identifier: 'AAPL', subcategory: 'large_cap' }] })
    const fires = await congressionalTradeTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(0.4)
    expect((fires[0].metadata as { elevations: string[] }).elevations).toEqual([])
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
  })

  it('elevates +0.2 when amount exceeds $50K threshold', async () => {
    houseMock.mockResolvedValueOnce({
      filings: [
        makeFiling({
          ticker: 'AAPL',
          member: 'Pelosi',
          chamber: 'house',
          amountBucket: { low: 50001, high: 100000, raw: '$50,001 - $100,000' },
        }),
      ],
      skippedRows: 0,
    })
    const p = prisma({ entities: [{ id: 'ent-aapl', identifier: 'AAPL', subcategory: 'large_cap' }] })
    const fires = await congressionalTradeTrigger(ctx(p))
    expect(fires[0].severity).toBeCloseTo(0.6, 2)
    expect((fires[0].metadata as { elevations: string[] }).elevations).toContain('high_value')
  })

  it('elevates +0.2 when ≥2 distinct members trade same ticker within 30d', async () => {
    houseMock.mockResolvedValueOnce({
      filings: [
        makeFiling({ ticker: 'AAPL', member: 'Pelosi', chamber: 'house', disclosedAt: '2026-04-10T10:00:00Z' }),
        makeFiling({ ticker: 'AAPL', member: 'Swalwell', chamber: 'house', disclosedAt: '2026-04-15T10:00:00Z' }),
      ],
      skippedRows: 0,
    })
    const p = prisma({ entities: [{ id: 'ent-aapl', identifier: 'AAPL', subcategory: 'large_cap' }] })
    const fires = await congressionalTradeTrigger(ctx(p))
    expect(fires[0].severity).toBeCloseTo(0.6, 2)
    expect((fires[0].metadata as { elevations: string[] }).elevations).toContain('multi_member')
  })

  it('logs unmatched tickers via CostLog.createMany', async () => {
    houseMock.mockResolvedValueOnce({
      filings: [
        makeFiling({ ticker: 'UNKNW', member: 'Pelosi', chamber: 'house' }),
      ],
      skippedRows: 0,
    })
    const p = prisma({}) // no entities
    await congressionalTradeTrigger(ctx(p))
    const cm = p.costLog.createMany as ReturnType<typeof vi.fn>
    expect(cm).toHaveBeenCalledTimes(1)
    const data = (cm.mock.calls[0][0] as { data: Array<{ operation: string }> }).data
    expect(data[0].operation).toBe('congressional-trade-unmatched-ticker')
  })

  it('advances cursor to max disclosedAt', async () => {
    houseMock.mockResolvedValueOnce({
      filings: [
        makeFiling({ ticker: 'AAPL', member: 'Pelosi', chamber: 'house', disclosedAt: '2026-04-10T10:00:00Z' }),
        makeFiling({ ticker: 'AAPL', member: 'Swalwell', chamber: 'house', disclosedAt: '2026-04-20T10:00:00Z' }),
      ],
      skippedRows: 0,
    })
    const p = prisma({ entities: [{ id: 'ent-aapl', identifier: 'AAPL', subcategory: 'large_cap' }] })
    await congressionalTradeTrigger(ctx(p))
    const upsert = p.triggerCursor.upsert as ReturnType<typeof vi.fn>
    expect(upsert).toHaveBeenCalledTimes(1)
    expect((upsert.mock.calls[0][0] as { create: { cursorValue: string } }).create.cursorValue).toBe('2026-04-20T10:00:00Z')
  })
})
