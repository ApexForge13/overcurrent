import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { sentimentExtremityBatchTrigger } from '@/lib/gap-score/triggers/narrative/sentiment-extremity-batch'
import { classifyDirection } from '@/lib/gap-score/triggers/narrative/keyword-lists'

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

describe('classifyDirection', () => {
  it('bullish-dominant → +1', () => {
    const c = classifyDirection('Stock surges on strong earnings')
    expect(c.direction).toBe(1)
    expect(c.bullishMatches).toContain('surges')
  })

  it('bearish-dominant → -1', () => {
    const c = classifyDirection('Stock plunges amid fraud probe')
    expect(c.direction).toBe(-1)
  })

  it('neutral text → null', () => {
    const c = classifyDirection('Company holds annual meeting')
    expect(c.direction).toBeNull()
  })
})

describe('T-N4 sentiment extremity batch', () => {
  it('fires when ≥8 matches AND ≥60% same direction', async () => {
    const obs = Array.from({ length: 10 }, () => ({
      entityId: 'e1',
      title: 'Stock surges on strong earnings',
    }))
    const fires = await sentimentExtremityBatchTrigger(ctx(obs))
    expect(fires).toHaveLength(1)
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
    expect(fires[0].stream).toBe('narrative')
  })

  it('does NOT fire below 8 matches', async () => {
    const obs = Array.from({ length: 5 }, () => ({
      entityId: 'e1',
      title: 'Stock surges on strong earnings',
    }))
    expect(await sentimentExtremityBatchTrigger(ctx(obs))).toHaveLength(0)
  })

  it('does NOT fire when consistency < 60%', async () => {
    // 5 bullish + 5 bearish = 50% consistency, below 60%
    const obs = [
      ...Array.from({ length: 5 }, () => ({ entityId: 'e1', title: 'Stock surges' })),
      ...Array.from({ length: 5 }, () => ({ entityId: 'e1', title: 'Stock plunges' })),
    ]
    expect(await sentimentExtremityBatchTrigger(ctx(obs))).toHaveLength(0)
  })

  it('fires with bearish direction when ≥8 bearish keywords dominate', async () => {
    const obs = Array.from({ length: 10 }, () => ({
      entityId: 'e1',
      title: 'Stock plunges on fraud investigation',
    }))
    const fires = await sentimentExtremityBatchTrigger(ctx(obs))
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
  })

  it('dedupes against recent T-N4 fires for same entity', async () => {
    const obs = Array.from({ length: 10 }, () => ({
      entityId: 'e1',
      title: 'Stock surges on strong earnings',
    }))
    expect(
      await sentimentExtremityBatchTrigger(ctx(obs, [{ entityId: 'e1' }])),
    ).toHaveLength(0)
  })
})
