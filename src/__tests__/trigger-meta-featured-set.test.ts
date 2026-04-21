import { describe, expect, it, vi } from 'vitest'
import { featuredSetBaselineTrigger } from '@/lib/gap-score/triggers/meta/featured-set-baseline'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

function makeCtx(featured: Array<{ id: string; identifier: string }>, now = new Date()) {
  return {
    now,
    prisma: {
      trackedEntity: {
        findMany: vi.fn().mockResolvedValue(featured),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-META2 featured set baseline scan', () => {
  it('fires one event per active featured entity', async () => {
    const fires = await featuredSetBaselineTrigger(
      makeCtx([
        { id: 'e1', identifier: 'AAPL' },
        { id: 'e2', identifier: 'BTC' },
        { id: 'e3', identifier: 'CL=F' },
      ]),
    )
    expect(fires).toHaveLength(3)
    for (const f of fires) {
      expect(f.triggerType).toBe('T-META2')
      expect(f.stream).toBe('meta')
      expect(f.severity).toBe(0.3)
      expect(f.metadata.reason).toBe('scheduled_featured_set_rescan')
    }
  })

  it('returns [] when no featured entities exist', async () => {
    const fires = await featuredSetBaselineTrigger(makeCtx([]))
    expect(fires).toEqual([])
  })

  it('metadata includes identifier + scheduled_at for observability', async () => {
    const now = new Date('2026-04-21T15:00:00Z')
    const fires = await featuredSetBaselineTrigger(makeCtx([{ id: 'e1', identifier: 'AAPL' }], now))
    expect(fires[0].metadata.identifier).toBe('AAPL')
    expect(fires[0].metadata.scheduled_at).toBe(now.toISOString())
  })
})
