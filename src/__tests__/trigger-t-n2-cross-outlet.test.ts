import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { crossOutletTrigger } from '@/lib/gap-score/triggers/narrative/cross-outlet'

function ctx(opts: {
  observations: Array<{ entityId: string; outlet: string | null }>
  recentFires?: Array<{ entityId: string }>
  now?: Date
  earningsQuietEntities?: Array<{ entityId: string }>
}): TriggerContext {
  return {
    now: opts.now ?? new Date('2026-04-22T12:00:00Z'),
    prisma: {
      entityObservation: {
        findMany: vi.fn().mockResolvedValue(opts.observations),
      },
      triggerEvent: {
        findMany: vi.fn().mockResolvedValue(opts.recentFires ?? []),
      },
      earningsSchedule: {
        findMany: vi.fn().mockResolvedValue(opts.earningsQuietEntities ?? []),
      },
      costLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-N2 cross-outlet amplification', () => {
  it('fires at severity 0.5 for exactly 5 distinct outlets', async () => {
    const observations = [
      { entityId: 'e1', outlet: 'reuters.com' },
      { entityId: 'e1', outlet: 'bloomberg.com' },
      { entityId: 'e1', outlet: 'wsj.com' },
      { entityId: 'e1', outlet: 'ft.com' },
      { entityId: 'e1', outlet: 'cnbc.com' },
    ]
    const fires = await crossOutletTrigger(ctx({ observations }))
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(0.5)
    expect((fires[0].metadata as { distinct_outlets: number }).distinct_outlets).toBe(5)
  })

  it('does NOT fire below threshold (4 outlets)', async () => {
    const observations = [
      { entityId: 'e1', outlet: 'reuters.com' },
      { entityId: 'e1', outlet: 'bloomberg.com' },
      { entityId: 'e1', outlet: 'wsj.com' },
      { entityId: 'e1', outlet: 'ft.com' },
    ]
    expect(await crossOutletTrigger(ctx({ observations }))).toHaveLength(0)
  })

  it('severity scales to 1.0 at 10 outlets', async () => {
    const observations = Array.from({ length: 10 }, (_, i) => ({
      entityId: 'e1',
      outlet: `outlet${i}.com`,
    }))
    const fires = await crossOutletTrigger(ctx({ observations }))
    expect(fires[0].severity).toBe(1.0)
  })

  it('dedupes against recent T-N2 fires for the same entity', async () => {
    const observations = Array.from({ length: 6 }, (_, i) => ({
      entityId: 'e1',
      outlet: `outlet${i}.com`,
    }))
    const fires = await crossOutletTrigger(
      ctx({ observations, recentFires: [{ entityId: 'e1' }] }),
    )
    expect(fires).toHaveLength(0)
  })

  it('suppresses entity in earnings quiet period (1c.2b.2 guard)', async () => {
    const observations = Array.from({ length: 6 }, (_, i) => ({
      entityId: 'e1',
      outlet: `outlet${i}.com`,
    }))
    const fires = await crossOutletTrigger(
      ctx({
        observations,
        earningsQuietEntities: [{ entityId: 'e1' }],
      }),
    )
    // Entity in earnings window → no fire emitted
    expect(fires).toHaveLength(0)
  })

  it('fires for entities NOT in earnings quiet period even when others are', async () => {
    const observations = [
      ...Array.from({ length: 6 }, (_, i) => ({ entityId: 'e1', outlet: `o${i}.com` })),
      ...Array.from({ length: 6 }, (_, i) => ({ entityId: 'e2', outlet: `o${i}.com` })),
    ]
    const fires = await crossOutletTrigger(
      ctx({
        observations,
        earningsQuietEntities: [{ entityId: 'e1' }], // only e1 suppressed
      }),
    )
    expect(fires).toHaveLength(1)
    expect(fires[0].entityId).toBe('e2')
  })

  it('suppresses ALL fires on FOMC day (regardless of entity)', async () => {
    const observations = Array.from({ length: 6 }, (_, i) => ({
      entityId: 'e1',
      outlet: `outlet${i}.com`,
    }))
    // 2026-04-29 = FOMC meeting day (hardcoded in FOMC_MEETING_DATES)
    const fires = await crossOutletTrigger(
      ctx({ observations, now: new Date('2026-04-29T14:00:00Z') }),
    )
    expect(fires).toHaveLength(0)
  })
})
