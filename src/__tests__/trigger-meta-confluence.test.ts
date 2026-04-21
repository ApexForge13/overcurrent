import { describe, expect, it, vi } from 'vitest'
import { multiStreamConfluenceTrigger } from '@/lib/gap-score/triggers/meta/multi-stream-confluence'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

function makeCtx(
  eventsInWindow: Array<{ id: string; entityId: string; stream: string; severity: number; triggerType: string }>,
  existingMetaFires: string[] = [],
  now: Date = new Date('2026-04-21T12:00:00Z'),
): TriggerContext {
  return {
    now,
    prisma: {
      triggerEvent: {
        findMany: vi.fn().mockImplementation(async (args) => {
          const where = (args as { where: { triggerType?: string; stream?: { in: string[] } } }).where
          if (where.triggerType === 'T-META1') {
            return existingMetaFires.map((id) => ({ entityId: id }))
          }
          if (where.stream?.in?.includes('narrative')) {
            return eventsInWindow
          }
          return []
        }),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-META1 multi-stream confluence', () => {
  it('fires when ≥2 distinct non-meta streams on same entity in window', async () => {
    const fires = await multiStreamConfluenceTrigger(
      makeCtx([
        { id: 'e1', entityId: 'ent-A', stream: 'narrative',    severity: 0.5, triggerType: 'T-N1' },
        { id: 'e2', entityId: 'ent-A', stream: 'ground_truth', severity: 0.8, triggerType: 'T-GT1' },
      ]),
    )
    expect(fires).toHaveLength(1)
    expect(fires[0].entityId).toBe('ent-A')
    expect(fires[0].triggerType).toBe('T-META1')
    expect(fires[0].stream).toBe('meta')
    expect(fires[0].severity).toBe(1.0)
    const streams = (fires[0].metadata.distinct_streams as string[]).sort()
    expect(streams).toEqual(['ground_truth', 'narrative'])
  })

  it('does NOT fire on single stream even with multiple triggers', async () => {
    const fires = await multiStreamConfluenceTrigger(
      makeCtx([
        { id: 'e1', entityId: 'ent-B', stream: 'narrative', severity: 0.5, triggerType: 'T-N1' },
        { id: 'e2', entityId: 'ent-B', stream: 'narrative', severity: 0.9, triggerType: 'T-N3' },
      ]),
    )
    expect(fires).toHaveLength(0)
  })

  it('does NOT re-fire when already-fired entity is in meta-fires window (dedup)', async () => {
    const fires = await multiStreamConfluenceTrigger(
      makeCtx(
        [
          { id: 'e1', entityId: 'ent-C', stream: 'narrative',     severity: 0.5, triggerType: 'T-N1' },
          { id: 'e2', entityId: 'ent-C', stream: 'psychological', severity: 0.8, triggerType: 'T-P1' },
        ],
        ['ent-C'],
      ),
    )
    expect(fires).toHaveLength(0)
  })

  it('captures max contributing severity in metadata', async () => {
    const fires = await multiStreamConfluenceTrigger(
      makeCtx([
        { id: 'e1', entityId: 'ent-D', stream: 'narrative',    severity: 0.3, triggerType: 'T-N1' },
        { id: 'e2', entityId: 'ent-D', stream: 'ground_truth', severity: 0.9, triggerType: 'T-GT1' },
      ]),
    )
    expect(fires[0].metadata.max_contributing_severity).toBe(0.9)
  })
})
