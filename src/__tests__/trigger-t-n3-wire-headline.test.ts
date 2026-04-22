import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { wireHeadlineTrigger } from '@/lib/gap-score/triggers/narrative/wire-headline'
import { matchWirePatterns } from '@/lib/gap-score/triggers/narrative/wire-patterns'

function ctx(obs: Array<{ id: string; entityId: string; title: string; sourceUrl?: string }>, recent: Array<{ metadata: Record<string, unknown> }> = []): TriggerContext {
  return {
    now: new Date('2026-04-22T12:00:00Z'),
    prisma: {
      entityObservation: {
        findMany: vi.fn().mockResolvedValue(
          obs.map((o) => ({
            id: o.id,
            entityId: o.entityId,
            title: o.title,
            outlet: 'reuters.com',
            sourceUrl: o.sourceUrl ?? `https://example.test/${o.id}`,
            observedAt: new Date('2026-04-22T11:30:00Z'),
          })),
        ),
      },
      triggerEvent: { findMany: vi.fn().mockResolvedValue(recent) },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('matchWirePatterns', () => {
  it('matches earnings beat → direction +1', () => {
    const m = matchWirePatterns('Apple beats consensus by 10%')
    expect(m.length).toBeGreaterThan(0)
    expect(m[0].direction).toBe(1)
    expect(m[0].category).toBe('earnings')
  })

  it('matches earnings miss → direction -1', () => {
    const m = matchWirePatterns('Tesla missed estimates on margin squeeze')
    expect(m[0].direction).toBe(-1)
  })

  it('matches guidance raise → direction +1', () => {
    const m = matchWirePatterns('Microsoft raises full-year guidance')
    expect(m[0].direction).toBe(1)
    expect(m[0].category).toBe('guidance')
  })

  it('matches FDA approval → direction +1', () => {
    const m = matchWirePatterns('Regulatory: FDA approves Pfizer RSV vaccine')
    expect(m[0].direction).toBe(1)
    expect(m[0].category).toBe('regulatory')
  })

  it('matches Chapter 11 → direction -1', () => {
    const m = matchWirePatterns('Retailer files Chapter 11 bankruptcy')
    expect(m[0].category).toBe('bankruptcy')
    expect(m[0].direction).toBe(-1)
  })

  it('matches acquisition → direction 0 (ambiguous)', () => {
    const m = matchWirePatterns('Acme acquires Globex for $5 billion')
    expect(m[0].category).toBe('m_and_a')
    expect(m[0].direction).toBe(0)
  })

  it('empty text returns no matches', () => {
    expect(matchWirePatterns('')).toEqual([])
  })
})

describe('T-N3 wire headline trigger', () => {
  it('fires once per (entity, sourceUrl) match', async () => {
    const fires = await wireHeadlineTrigger(
      ctx([{ id: 'o1', entityId: 'e1', title: 'Apple beats consensus' }]),
    )
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(1.0)
    const md = fires[0].metadata as { direction: number; dominant_category: string }
    expect(md.direction).toBe(1)
    expect(md.dominant_category).toBe('earnings')
  })

  it('dedupes against recent fires by (entityId, sourceUrl) key', async () => {
    const fires = await wireHeadlineTrigger(
      ctx(
        [{ id: 'o1', entityId: 'e1', title: 'Apple beats consensus', sourceUrl: 'https://x.test/a1' }],
        [{ metadata: { entityId: 'e1', source_url: 'https://x.test/a1' } }],
      ),
    )
    expect(fires).toHaveLength(0)
  })

  it('picks dominant directional match over ambiguous (e.g., earnings beat wins over merger mention)', async () => {
    const fires = await wireHeadlineTrigger(
      ctx([{ id: 'o1', entityId: 'e1', title: 'Apple beats consensus after merger with Beats' }]),
    )
    const md = fires[0].metadata as { direction: number }
    // Earnings beat (+1) wins over merger (0)
    expect(md.direction).toBe(1)
  })
})
