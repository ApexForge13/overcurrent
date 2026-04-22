import { describe, expect, it } from 'vitest'
import { QUEUE_NAMES, ALL_QUEUE_NAMES } from '@/lib/queue/names'

describe('queue names contract', () => {
  it('exposes exactly 10 queues (3 gap-score + 2 phase-1c trigger infra + 1 consensus + 4 paper-trading)', () => {
    expect(Object.keys(QUEUE_NAMES)).toHaveLength(10)
    expect(ALL_QUEUE_NAMES).toHaveLength(10)
  })

  it('every value is lowercase kebab-case with no colon (BullMQ constraint)', () => {
    // BullMQ rejects queue names containing ':'. Our convention is dashes
    // only, starting with one of the recognized domain prefixes.
    const pattern = /^(gap-score|paper-trading|candidate-generator|trigger-scan|macro-consensus-scrape)(-[a-z-]+)?$/
    for (const value of Object.values(QUEUE_NAMES)) {
      expect(value).toMatch(pattern)
      expect(value).not.toContain(':')
    }
  })

  it('has no duplicate queue values', () => {
    const values = Object.values(QUEUE_NAMES)
    expect(new Set(values).size).toBe(values.length)
  })

  it('uses the expected domain prefixes', () => {
    const prefixes = new Set(
      Object.values(QUEUE_NAMES).map((v) => {
        if (v.startsWith('gap-score-')) return 'gap-score'
        if (v.startsWith('paper-trading-')) return 'paper-trading'
        return v // candidate-generator, trigger-scan, macro-consensus-scrape are their own prefixes
      }),
    )
    expect(prefixes).toEqual(
      new Set([
        'gap-score',
        'paper-trading',
        'candidate-generator',
        'trigger-scan',
        'macro-consensus-scrape',
      ]),
    )
  })

  it('ALL_QUEUE_NAMES contains the same values as QUEUE_NAMES', () => {
    const fromConst = new Set(Object.values(QUEUE_NAMES))
    const fromList = new Set(ALL_QUEUE_NAMES)
    expect(fromList).toEqual(fromConst)
  })
})
