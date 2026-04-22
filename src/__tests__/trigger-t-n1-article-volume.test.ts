import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { articleVolumeSpikeTrigger } from '@/lib/gap-score/triggers/narrative/article-volume-spike'

function ctx(opts: {
  currentRollups: Array<{ entityId: string; count: number }>
  baselines: Array<{ entityId: string; mean: number; stddev: number }>
  now?: Date
}): TriggerContext {
  return {
    now: opts.now ?? new Date('2026-04-22T12:00:00Z'),
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

describe('T-N1 article volume spike', () => {
  it('fires when z > 2 and count >= 5 and baseline mature', async () => {
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 20 }],
        baselines: [{ entityId: 'e1', mean: 3, stddev: 2 }],
      }),
    )
    // z = (20 - 3) / 2 = 8.5, capped severity at 1.0 (8.5/4 > 1)
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(1.0)
    expect(fires[0].stream).toBe('narrative')
    expect((fires[0].metadata as { z_score: number }).z_score).toBeCloseTo(8.5, 2)
  })

  it('does NOT fire when z <= 2', async () => {
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 7 }],
        baselines: [{ entityId: 'e1', mean: 3, stddev: 2 }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('absolute floor rejects low-count spikes even if z is huge', async () => {
    // currentRollups filter already applies {count: {gte: 5}} — entities
    // with count < 5 don't appear in the result set at all. This test
    // documents that behavior at the query level.
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [], // filter would exclude count=3
        baselines: [{ entityId: 'e1', mean: 0.1, stddev: 0.01 }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('does NOT fire when baseline is immature (no row in findMany result)', async () => {
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 20 }],
        baselines: [], // empty — immature entities don't come back from findMany
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('caps severity at 1.0 for extreme z-scores', async () => {
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 100 }],
        baselines: [{ entityId: 'e1', mean: 2, stddev: 1 }],
      }),
    )
    expect(fires[0].severity).toBe(1.0)
  })

  it('emits direction=0 (downstream sentiment scoring determines)', async () => {
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 15 }],
        baselines: [{ entityId: 'e1', mean: 3, stddev: 2 }],
      }),
    )
    expect((fires[0].metadata as { direction: number }).direction).toBe(0)
  })

  it('skips entities with degenerate stddev=0 baseline', async () => {
    const fires = await articleVolumeSpikeTrigger(
      ctx({
        currentRollups: [{ entityId: 'e1', count: 10 }],
        baselines: [{ entityId: 'e1', mean: 3, stddev: 0 }],
      }),
    )
    expect(fires).toHaveLength(0)
  })
})
