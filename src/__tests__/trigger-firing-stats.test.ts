import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getFiringStats } from '@/lib/gap-score/triggers/firing-stats'

function makePrisma(
  opts: {
    count24h?: Array<{ triggerType: string; _count: { _all: number } }>
    count7d?: Array<{ triggerType: string; _count: { _all: number } }>
    count30d?: Array<{ triggerType: string; _count: { _all: number } }>
    latest?: Array<{ triggerType: string; _max: { firedAt: Date | null } }>
  },
  reference: Date,
): PrismaClient {
  return {
    triggerEvent: {
      groupBy: vi.fn().mockImplementation(({ where, _max }: { where?: { firedAt?: { gte: Date } }; _max?: unknown }) => {
        if (_max) return Promise.resolve(opts.latest ?? [])
        // Differentiate by relative window via the `gte` cutoff (computed
        // from the reference passed into getFiringStats, not Date.now()).
        if (!where?.firedAt?.gte) return Promise.resolve([])
        const ageHours = (reference.getTime() - where.firedAt.gte.getTime()) / (60 * 60 * 1000)
        if (ageHours <= 25) return Promise.resolve(opts.count24h ?? [])
        if (ageHours <= 7 * 24 + 1) return Promise.resolve(opts.count7d ?? [])
        return Promise.resolve(opts.count30d ?? [])
      }),
    },
  } as unknown as PrismaClient
}

describe('getFiringStats', () => {
  it('returns map keyed by triggerType with all four fields populated', async () => {
    const lastFired = new Date('2026-04-22T10:00:00Z')
    const ref = new Date('2026-04-22T12:00:00Z')
    const prisma = makePrisma({
      count24h: [{ triggerType: 'T-N1', _count: { _all: 5 } }],
      count7d: [{ triggerType: 'T-N1', _count: { _all: 30 } }],
      count30d: [{ triggerType: 'T-N1', _count: { _all: 100 } }],
      latest: [{ triggerType: 'T-N1', _max: { firedAt: lastFired } }],
    }, ref)
    const stats = await getFiringStats(prisma, ref)
    const n1 = stats.get('T-N1')
    expect(n1).toBeDefined()
    expect(n1?.fires24h).toBe(5)
    expect(n1?.fires7d).toBe(30)
    expect(n1?.fires30d).toBe(100)
    expect(n1?.lastFiredAt?.toISOString()).toBe(lastFired.toISOString())
  })

  it('triggers absent from one window default to 0 in that bucket', async () => {
    const ref = new Date('2026-04-22T12:00:00Z')
    const prisma = makePrisma({
      count24h: [], // no fires last 24h
      count7d: [{ triggerType: 'T-N1', _count: { _all: 10 } }],
      count30d: [{ triggerType: 'T-N1', _count: { _all: 50 } }],
      latest: [{ triggerType: 'T-N1', _max: { firedAt: new Date('2026-04-15T00:00:00Z') } }],
    }, ref)
    const stats = await getFiringStats(prisma, ref)
    const n1 = stats.get('T-N1')
    expect(n1?.fires24h).toBe(0)
    expect(n1?.fires7d).toBe(10)
  })

  it('empty event table → empty map', async () => {
    const ref = new Date('2026-04-22T12:00:00Z')
    const prisma = makePrisma({}, ref)
    const stats = await getFiringStats(prisma, ref)
    expect(stats.size).toBe(0)
  })
})
