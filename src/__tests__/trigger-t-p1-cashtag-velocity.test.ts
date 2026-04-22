import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { cashtagVelocityTrigger } from '@/lib/gap-score/triggers/psychological/cashtag-velocity'

function ctx(opts: {
  currentRollups: Array<{ entityId: string; count: number }>
  baselines: Array<{ entityId: string; mean: number; stddev: number }>
}): TriggerContext {
  return {
    now: new Date('2026-04-22T12:00:00Z'),
    prisma: {
      entityObservationHourly: {
        findMany: vi.fn().mockResolvedValue(opts.currentRollups),
      },
      entityBaseline: {
        findMany: vi.fn().mockResolvedValue(opts.baselines),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-P1 cashtag velocity', () => {
  it('fires when z > 3 and count >= 20 and baseline mature', async () => {
    const fires = await cashtagVelocityTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 50 }],
        baselines: [{ entityId: 'e1', mean: 5, stddev: 3 }],
      }),
    )
    // z = (50-5)/3 = 15, cap 1.0
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(1.0)
    expect(fires[0].stream).toBe('psychological')
  })

  it('does NOT fire when z <= 3', async () => {
    const fires = await cashtagVelocityTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 25 }],
        baselines: [{ entityId: 'e1', mean: 15, stddev: 5 }],
      }),
    )
    // z = (25-15)/5 = 2, below 3
    expect(fires).toHaveLength(0)
  })

  it('absolute floor rejects low-count entities (findMany filters out)', async () => {
    const fires = await cashtagVelocityTrigger(
      ctx({
        currentRollups: [], // findMany filter gte:20 excludes
        baselines: [],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('immature baseline → no fire', async () => {
    const fires = await cashtagVelocityTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 100 }],
        baselines: [], // empty = immature/missing
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('severity cap at 1.0 for extreme z', async () => {
    const fires = await cashtagVelocityTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 1000 }],
        baselines: [{ entityId: 'e1', mean: 5, stddev: 1 }],
      }),
    )
    expect(fires[0].severity).toBe(1.0)
  })
})
