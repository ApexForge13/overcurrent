import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/raw-signals/clients/sec-edgar-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/sec-edgar-client')
  >('@/lib/raw-signals/clients/sec-edgar-client')
  return { ...actual, pollRecentFilings: vi.fn() }
})

import { sec8KTrigger, extractItemCodes } from '@/lib/gap-score/triggers/ground-truth/sec-8-k'
import { pollRecentFilings, type SecFilingHit } from '@/lib/raw-signals/clients/sec-edgar-client'

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

function makeHit(summary: string, accession = 'acc1'): SecFilingHit {
  return {
    accessionNumber: accession,
    filedAt: '2026-04-20',
    formType: '8-K',
    displayNames: ['TargetCo (CIK 00042) (Filer)'],
    ciks: ['00042'],
    tickers: ['TARG'],
    summary,
  }
}

describe('T-GT3 SEC 8-K', () => {
  beforeEach(() => {
    pollMock.mockReset()
  })

  it('extractItemCodes recognizes multiple item patterns', () => {
    const hit = makeHit('Item 1.01 Entry into a Material Definitive Agreement')
    expect(extractItemCodes(hit)).toEqual(['1.01'])
    const multi = makeHit('Item 4.02 Non-Reliance... also references Item 5.02 Departure of Officer')
    expect(extractItemCodes(multi).sort()).toEqual(['4.02', '5.02'])
  })

  it('Item 4.02 fires with severity 1.0 and direction=-1 (auditor warning)', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('ITEM 4.02 Non-Reliance on Previously Issued Financial Statements')],
    })
    const p = prisma({ entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }] })
    const fires = await sec8KTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(1.0)
    const md = fires[0].metadata as { direction: number; dominant_item: string }
    expect(md.direction).toBe(-1)
    expect(md.dominant_item).toBe('4.02')
  })

  it('Item 1.01 fires at severity 0.7 with direction 0', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('Item 1.01 Entry into a Material Definitive Agreement')],
    })
    const p = prisma({ entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }] })
    const fires = await sec8KTrigger(ctx(p))
    expect(fires[0].severity).toBeCloseTo(0.7, 2)
    expect((fires[0].metadata as { direction: number }).direction).toBe(0)
  })

  it('Item 1.02 termination fires at severity 0.8', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('Item 1.02 Termination of a Material Definitive Agreement')],
    })
    const p = prisma({ entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }] })
    const fires = await sec8KTrigger(ctx(p))
    expect(fires[0].severity).toBeCloseTo(0.8, 2)
  })

  it('Item 5.02 exec change fires at severity 0.6', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('Item 5.02 Departure of Directors or Certain Officers')],
    })
    const p = prisma({ entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }] })
    const fires = await sec8KTrigger(ctx(p))
    expect(fires[0].severity).toBeCloseTo(0.6, 2)
  })

  it('multiple items — dominant (highest severity) wins; 4.02 over 5.02', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('Item 5.02 Departure. Also Item 4.02 Non-Reliance.')],
    })
    const p = prisma({ entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }] })
    const fires = await sec8KTrigger(ctx(p))
    expect(fires[0].severity).toBe(1.0)
    const md = fires[0].metadata as { dominant_item: string; item_codes: string[] }
    expect(md.dominant_item).toBe('4.02')
    expect(md.item_codes.sort()).toEqual(['4.02', '5.02'])
  })

  it('8-K without parseable items fires at fallback severity 0.5', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('Regulation FD Disclosure')],
    })
    const p = prisma({ entities: [{ id: 'ent-targ', identifier: 'TARG', providerIds: {}, active: true }] })
    const fires = await sec8KTrigger(ctx(p))
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(0.5)
    expect((fires[0].metadata as { criterion: string }).criterion).toBe('8k_no_item_parsed')
  })

  it('unresolved 8-K filings log to CostLog and do NOT fire', async () => {
    pollMock.mockResolvedValueOnce({
      ok: true,
      hits: [makeHit('Item 1.01', 'acc-orphan')],
    })
    const p = prisma({}) // no entities
    const fires = await sec8KTrigger(ctx(p))
    expect(fires).toEqual([])
    expect(p.costLog.createMany as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
  })
})
