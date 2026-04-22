import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { engagementVelocityTrigger } from '@/lib/gap-score/triggers/psychological/engagement-velocity'

function ctx(opts: {
  rollups: Array<{ entityId: string; hourStart: Date; engagementSum: number | null }>
  recentFires?: Array<{ entityId: string }>
}): TriggerContext {
  return {
    now: new Date('2026-04-22T12:30:00Z'),
    prisma: {
      entityObservationHourly: {
        findMany: vi.fn().mockResolvedValue(opts.rollups),
      },
      triggerEvent: {
        findMany: vi.fn().mockResolvedValue(opts.recentFires ?? []),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

const LAST_HOUR = new Date('2026-04-22T11:00:00Z')
const PREV_HOUR = new Date('2026-04-22T10:00:00Z')

describe('T-P2 engagement velocity acceleration', () => {
  it('fires at 2× acceleration with severity 0.5', async () => {
    const fires = await engagementVelocityTrigger(
      ctx({
        rollups: [
          { entityId: 'e1', hourStart: LAST_HOUR, engagementSum: 200 },
          { entityId: 'e1', hourStart: PREV_HOUR, engagementSum: 100 },
        ],
      }),
    )
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(0.5)
    expect((fires[0].metadata as { acceleration_factor: number }).acceleration_factor).toBe(2)
  })

  it('severity scales to 1.0 at 5× acceleration', async () => {
    const fires = await engagementVelocityTrigger(
      ctx({
        rollups: [
          { entityId: 'e1', hourStart: LAST_HOUR, engagementSum: 500 },
          { entityId: 'e1', hourStart: PREV_HOUR, engagementSum: 100 },
        ],
      }),
    )
    expect(fires[0].severity).toBe(1.0)
  })

  it('does NOT fire below 100 engagement events in last hour', async () => {
    const fires = await engagementVelocityTrigger(
      ctx({
        rollups: [
          { entityId: 'e1', hourStart: LAST_HOUR, engagementSum: 80 }, // below floor
          { entityId: 'e1', hourStart: PREV_HOUR, engagementSum: 10 },
        ],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('does NOT fire below 2× acceleration', async () => {
    const fires = await engagementVelocityTrigger(
      ctx({
        rollups: [
          { entityId: 'e1', hourStart: LAST_HOUR, engagementSum: 150 },
          { entityId: 'e1', hourStart: PREV_HOUR, engagementSum: 100 }, // 1.5× only
        ],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('handles zero-previous-hour without div-by-zero blowup', async () => {
    const fires = await engagementVelocityTrigger(
      ctx({
        rollups: [
          { entityId: 'e1', hourStart: LAST_HOUR, engagementSum: 200 },
          // prev hour missing entirely
        ],
      }),
    )
    // denom floored at 1 → acceleration = 200; severity capped 1.0
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(1.0)
  })

  it('dedupes against recent T-P2 fires', async () => {
    const fires = await engagementVelocityTrigger(
      ctx({
        rollups: [
          { entityId: 'e1', hourStart: LAST_HOUR, engagementSum: 300 },
          { entityId: 'e1', hourStart: PREV_HOUR, engagementSum: 100 },
        ],
        recentFires: [{ entityId: 'e1' }],
      }),
    )
    expect(fires).toHaveLength(0)
  })
})
