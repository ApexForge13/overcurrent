import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { sentimentExtremityConsensusTrigger } from '@/lib/gap-score/triggers/psychological/sentiment-extremity-consensus'

function ctx(obs: Array<{ entityId: string; title: string }>, recent: Array<{ entityId: string }> = []): TriggerContext {
  return {
    now: new Date('2026-04-22T12:00:00Z'),
    prisma: {
      entityObservation: {
        findMany: vi.fn().mockResolvedValue(obs),
      },
      triggerEvent: {
        findMany: vi.fn().mockResolvedValue(recent),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-P4 sentiment extremity consensus', () => {
  it('fires when ≥30 matches AND ≥75% same direction', async () => {
    const obs = Array.from({ length: 40 }, () => ({
      entityId: 'e1',
      title: 'Stock surges on strong earnings',
    }))
    const fires = await sentimentExtremityConsensusTrigger(ctx(obs))
    expect(fires).toHaveLength(1)
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
    expect(fires[0].stream).toBe('psychological')
  })

  it('does NOT fire below 30 matches', async () => {
    const obs = Array.from({ length: 20 }, () => ({
      entityId: 'e1',
      title: 'Stock surges on strong earnings',
    }))
    expect(await sentimentExtremityConsensusTrigger(ctx(obs))).toHaveLength(0)
  })

  it('does NOT fire below 75% consistency', async () => {
    // 70% bullish, 30% bearish → 70% below threshold
    const obs = [
      ...Array.from({ length: 21 }, () => ({ entityId: 'e1', title: 'Stock surges' })),
      ...Array.from({ length: 9 }, () => ({ entityId: 'e1', title: 'Stock plunges' })),
    ]
    expect(await sentimentExtremityConsensusTrigger(ctx(obs))).toHaveLength(0)
  })

  it('fires with bearish direction when dominant', async () => {
    const obs = Array.from({ length: 40 }, () => ({
      entityId: 'e1',
      title: 'Stock plunges on fraud probe',
    }))
    const fires = await sentimentExtremityConsensusTrigger(ctx(obs))
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
  })

  it('dedupes against recent T-P4 fires', async () => {
    const obs = Array.from({ length: 40 }, () => ({
      entityId: 'e1',
      title: 'Stock surges on earnings',
    }))
    expect(
      await sentimentExtremityConsensusTrigger(ctx(obs, [{ entityId: 'e1' }])),
    ).toHaveLength(0)
  })
})
