import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/raw-signals/clients/sec-edgar-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/sec-edgar-client')
  >('@/lib/raw-signals/clients/sec-edgar-client')
  return {
    ...actual,
    pollRecentFilings: vi.fn(),
  }
})

import { secForm4Trigger, form4SeverityFromUsd } from '@/lib/gap-score/triggers/ground-truth/sec-form-4'
import { pollRecentFilings } from '@/lib/raw-signals/clients/sec-edgar-client'

interface MockTrackedEntity {
  id: string
  identifier: string
  providerIds: { cik?: string }
  active: boolean
}

function mockPrisma(opts: {
  entities?: MockTrackedEntity[]
  cursor?: string
}): TriggerContext['prisma'] {
  return {
    trackedEntity: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { identifier?: { in: string[] } } }) => {
        const entities = opts.entities ?? []
        if (where.identifier?.in) {
          const set = new Set(where.identifier.in.map((s) => s.toUpperCase()))
          return Promise.resolve(
            entities.filter((e) => set.has(e.identifier.toUpperCase())),
          )
        }
        return Promise.resolve(entities.filter((e) => e.active))
      }),
    },
    triggerCursor: {
      findUnique: vi.fn().mockResolvedValue(opts.cursor ? { cursorValue: opts.cursor } : null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    costLog: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as TriggerContext['prisma']
}

function ctx(prisma: TriggerContext['prisma']): TriggerContext {
  return { prisma, now: new Date('2026-04-21T12:00:00Z') }
}

const pollMock = vi.mocked(pollRecentFilings)

describe('T-GT1 SEC Form 4', () => {
  beforeEach(() => {
    pollMock.mockReset()
  })

  it('returns [] when EDGAR returns zero hits', async () => {
    pollMock.mockResolvedValueOnce({ ok: true, hits: [] })
    const fires = await secForm4Trigger(ctx(mockPrisma({})))
    expect(fires).toEqual([])
  })

  it('fires on ≥2 insiders at same issuer within 48h (resolved by ticker)', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        {
          accessionNumber: 'a1',
          filedAt: '2026-04-19',
          formType: '4',
          displayNames: ['Insider One (CIK 00001) (Reporting)'],
          ciks: ['00001'],
          tickers: ['ACME'],
        },
        {
          accessionNumber: 'a2',
          filedAt: '2026-04-20',
          formType: '4',
          displayNames: ['Insider Two (CIK 00002) (Reporting)'],
          ciks: ['00002'],
          tickers: ['ACME'],
        },
      ],
    })
    const prisma = mockPrisma({
      entities: [{ id: 'ent-acme', identifier: 'ACME', providerIds: {}, active: true }],
    })
    const fires = await secForm4Trigger(ctx(prisma))
    expect(fires).toHaveLength(1)
    expect(fires[0].entityId).toBe('ent-acme')
    expect(fires[0].severity).toBe(0.5) // 2-filing cluster
    expect((fires[0].metadata as { criterion: string }).criterion).toBe('insider_cluster')
  })

  it('bumps severity to 0.7 when ≥3 filings cluster', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        { accessionNumber: 'a1', filedAt: '2026-04-19', formType: '4', displayNames: [''], ciks: [], tickers: ['ACME'] },
        { accessionNumber: 'a2', filedAt: '2026-04-20', formType: '4', displayNames: [''], ciks: [], tickers: ['ACME'] },
        { accessionNumber: 'a3', filedAt: '2026-04-20', formType: '4', displayNames: [''], ciks: [], tickers: ['ACME'] },
      ],
    })
    const prisma = mockPrisma({
      entities: [{ id: 'ent-acme', identifier: 'ACME', providerIds: {}, active: true }],
    })
    const fires = await secForm4Trigger(ctx(prisma))
    expect(fires[0].severity).toBe(0.7)
  })

  it('does NOT fire for single-filing issuers (cluster requires ≥2)', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        { accessionNumber: 'a1', filedAt: '2026-04-19', formType: '4', displayNames: [''], ciks: [], tickers: ['ACME'] },
      ],
    })
    const prisma = mockPrisma({
      entities: [{ id: 'ent-acme', identifier: 'ACME', providerIds: {}, active: true }],
    })
    const fires = await secForm4Trigger(ctx(prisma))
    expect(fires).toEqual([])
  })

  it('advances cursor to max filedAt on success', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        { accessionNumber: 'a1', filedAt: '2026-04-19', formType: '4', displayNames: [''], ciks: [], tickers: ['ACME'] },
        { accessionNumber: 'a2', filedAt: '2026-04-20', formType: '4', displayNames: [''], ciks: [], tickers: ['ACME'] },
      ],
    })
    const prisma = mockPrisma({
      entities: [{ id: 'ent-acme', identifier: 'ACME', providerIds: {}, active: true }],
    })
    await secForm4Trigger(ctx(prisma))
    const upsertMock = prisma.triggerCursor.upsert as ReturnType<typeof vi.fn>
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const call = upsertMock.mock.calls[0][0] as { create: { cursorValue: string } }
    expect(call.create.cursorValue).toBe('2026-04-20')
  })

  it('logs unresolved filings to CostLog', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        { accessionNumber: 'unm-1', filedAt: '2026-04-19', formType: '4', displayNames: ['Unknown Corp'], ciks: ['999999'], tickers: ['UNKNW'] },
      ],
    })
    const prisma = mockPrisma({}) // no entities — all unresolved
    await secForm4Trigger(ctx(prisma))
    const cm = prisma.costLog.createMany as ReturnType<typeof vi.fn>
    expect(cm).toHaveBeenCalledTimes(1)
    const data = (cm.mock.calls[0][0] as { data: Array<{ operation: string; metadata: Record<string, unknown> }> }).data
    expect(data[0].operation).toBe('sec-unmatched-filing')
    expect(data[0].metadata.accessionNumber).toBe('unm-1')
  })

  it('form4SeverityFromUsd follows the log-scaled ladder', () => {
    expect(form4SeverityFromUsd(0)).toBe(0)
    expect(form4SeverityFromUsd(500_000)).toBe(0)      // below $1M floor
    expect(form4SeverityFromUsd(1_000_000)).toBeCloseTo(0.3, 2)
    expect(form4SeverityFromUsd(10_000_000)).toBeCloseTo(0.6, 2)
    expect(form4SeverityFromUsd(100_000_000)).toBe(1.0)
    expect(form4SeverityFromUsd(1_000_000_000)).toBe(1.0)
  })

  it('throws when EDGAR poll fails (dispatcher catches and CostLogs)', async () => {
    pollMock.mockResolvedValueOnce({ ok: false, errorType: 'rate_limited', retryAfterSec: 60 })
    await expect(secForm4Trigger(ctx(mockPrisma({})))).rejects.toThrow(/rate_limited/)
  })
})
