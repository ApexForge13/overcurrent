import { describe, it, expect } from 'vitest'
import { filterAnalystsBySubset } from '@/lib/debate'
import { DEBATE_MODELS } from '@/lib/debate-config'
import type { DebateModel } from '@/lib/debate-config'

const ALL_FOUR: DebateModel[] = [
  DEBATE_MODELS.analyst_1, // Claude (anthropic)
  DEBATE_MODELS.analyst_2, // GPT-5.4 (openai)
  DEBATE_MODELS.analyst_3, // Gemini (google)
  DEBATE_MODELS.analyst_4, // Grok (xai)
]

describe('filterAnalystsBySubset', () => {
  it('returns the full pool when no subset is provided', () => {
    expect(filterAnalystsBySubset(ALL_FOUR)).toHaveLength(4)
    expect(filterAnalystsBySubset(ALL_FOUR, undefined)).toHaveLength(4)
  })

  it('returns the full pool when subset is empty (no-op)', () => {
    expect(filterAnalystsBySubset(ALL_FOUR, [])).toHaveLength(4)
  })

  it('Flag 1 two-model variant (anthropic + xai) returns Claude + Grok only', () => {
    const result = filterAnalystsBySubset(ALL_FOUR, ['anthropic', 'xai'])
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.provider).sort()).toEqual(['anthropic', 'xai'])
    expect(result.map((a) => a.name).sort()).toEqual(['Claude', 'Grok'])
  })

  it('preserves ordering of input pool (anthropic comes before xai in the source list)', () => {
    const result = filterAnalystsBySubset(ALL_FOUR, ['xai', 'anthropic'])
    expect(result.map((a) => a.provider)).toEqual(['anthropic', 'xai'])
  })

  it('drops analysts whose provider is not in the subset', () => {
    const result = filterAnalystsBySubset(ALL_FOUR, ['anthropic'])
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('anthropic')
  })

  it('subset with no matching providers returns empty (small input pool case)', () => {
    // Take a 2-element pool and ask for a subset that doesn't include either
    const smallPool: DebateModel[] = [DEBATE_MODELS.analyst_1, DEBATE_MODELS.analyst_2]
    const result = filterAnalystsBySubset(smallPool, ['google'])
    expect(result).toEqual([])
  })

  it('does not mutate the input pool', () => {
    const original = [...ALL_FOUR]
    filterAnalystsBySubset(ALL_FOUR, ['anthropic'])
    expect(ALL_FOUR).toEqual(original)
  })

  it('returns a fresh array (callers can mutate without affecting source)', () => {
    const a = filterAnalystsBySubset(ALL_FOUR)
    const b = filterAnalystsBySubset(ALL_FOUR)
    expect(a).not.toBe(b)
    a.pop()
    expect(b).toHaveLength(4)
  })
})
