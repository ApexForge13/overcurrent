import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/raw-signals/clients/sec-edgar-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/sec-edgar-client')
  >('@/lib/raw-signals/clients/sec-edgar-client')
  return { ...actual, pollRecentFilings: vi.fn() }
})

import { sec13DGTrigger } from '@/lib/gap-score/triggers/ground-truth/sec-13d-g'
import { pollRecentFilings } from '@/lib/raw-signals/clients/sec-edgar-client'

const pollMock = vi.mocked(pollRecentFilings)

function prisma(opts: {
  entities?: Array<{ id: string; identifier: string; providerIds: { cik?: string }; active: boolean }>
}): TriggerContext['prisma'] {
  return {
    trackedEntity: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { identifier?: { in: string[] } } }) => {
        const entities = opts.entities ?? []
        if (where.identifier?.in) {
          const set = new Set(where.identifier.in.map((s) => s.toUpperCase()))
          return Promise.resolve(entities.filter((e) => set.has(e.identifier.toUpperCase())))
        }
        return Promise.resolve(entities.filter((e) => e.active))
      }),
    },
    triggerCursor: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    costLog: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as TriggerContext['prisma']
}

function ctx(p: TriggerContext['prisma']): TriggerContext {
  return { prisma: p, now: new Date('2026-04-21T12:00:00Z') }
}

describe('T-GT2 SEC 13D/G', () => {
  beforeEach(() => {
    pollMock.mockReset()
  })

  it('fires severity 1.0 with direction=+1 for accumulation filer', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        {
          accessionNumber: 'a1',
          filedAt: '2026-04-20',
          formType: 'SC 13D',
          displayNames: ['Long Value Partners LP (CIK 000555) (Filer)'],
          ciks: ['000555'],
          tickers: ['TARG'],
        },
      ],
    })
    const p = prisma({
      entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }],
    })
    const fires = await sec13DGTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(1.0)
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
    expect((fires[0].metadata as { short_activist_override: boolean }).short_activist_override).toBe(false)
  })

  it('reverses direction to -1 when filer is a known short-seller activist', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        {
          accessionNumber: 'a1',
          filedAt: '2026-04-20',
          formType: 'SC 13D',
          displayNames: ['Hindenburg Research LLC (CIK 999) (Filer)'],
          ciks: ['999'],
          tickers: ['TARG'],
        },
      ],
    })
    const p = prisma({
      entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }],
    })
    const fires = await sec13DGTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
    expect((fires[0].metadata as { short_activist_override: boolean }).short_activist_override).toBe(true)
  })

  it('fires on SC 13G filings too (not just SC 13D)', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [
        {
          accessionNumber: 'a1',
          filedAt: '2026-04-20',
          formType: 'SC 13G',
          displayNames: ['Passive Index Fund'],
          ciks: [],
          tickers: ['TARG'],
        },
      ],
    })
    const p = prisma({
      entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }],
    })
    const fires = await sec13DGTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect((fires[0].metadata as { formType: string }).formType).toBe('SC 13G')
  })

  it('respects cursor — uses cursor value in poll call', async () => {
    pollMock.mockResolvedValueOnce({ ok: true, hits: [] })
    const p = prisma({})
    ;(p.triggerCursor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ cursorValue: '2026-04-15' })
    await sec13DGTrigger(ctx(p))
    expect(pollMock).toHaveBeenCalledWith(expect.objectContaining({ sinceCursor: '2026-04-15' }))
  })
})
