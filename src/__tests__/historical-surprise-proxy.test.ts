import { describe, expect, it } from 'vitest'
import { computeSurpriseProxy } from '@/lib/historical-data/surprise-proxy'

describe('computeSurpriseProxy', () => {
  it('returns neutral default (stddev=1.0, deltaCount=0) for empty input', () => {
    expect(computeSurpriseProxy([])).toEqual({ stddev: 1.0, deltaCount: 0, deltas: [] })
  })

  it('returns neutral default for single observation', () => {
    const r = computeSurpriseProxy([{ date: '2024-01-01', value: 100 }])
    expect(r.stddev).toBe(1.0)
    expect(r.deltaCount).toBe(0)
  })

  it('computes release-to-release percent deltas for 3+ observations', () => {
    const r = computeSurpriseProxy([
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 110 }, // +10%
      { date: '2024-03-01', value: 99 },  // -10%
      { date: '2024-04-01', value: 99 },  // 0%
    ])
    expect(r.deltaCount).toBe(3)
    expect(r.deltas).toEqual([0.1, expect.closeTo(-0.1, 10), 0])
    expect(r.stddev).toBeGreaterThan(0)
  })

  it('sorts observations by date before computing deltas', () => {
    const unsorted = computeSurpriseProxy([
      { date: '2024-03-01', value: 120 },
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 110 },
    ])
    const sorted = computeSurpriseProxy([
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 110 },
      { date: '2024-03-01', value: 120 },
    ])
    expect(unsorted.deltas).toEqual(sorted.deltas)
  })

  it('skips deltas where the prior value is zero (avoids division by zero)', () => {
    const r = computeSurpriseProxy([
      { date: '2024-01-01', value: 0 },
      { date: '2024-02-01', value: 5 },  // skipped: prev=0
      { date: '2024-03-01', value: 10 }, // kept: (10-5)/5 = 1
    ])
    expect(r.deltaCount).toBe(1)
    expect(r.deltas).toEqual([1])
  })

  it('returns positive stddev floor when all deltas are identical', () => {
    const r = computeSurpriseProxy([
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 110 },
      { date: '2024-03-01', value: 121 },
    ])
    // Both deltas are 0.1 exactly; population stddev = 0.
    // Proxy floor = 1.0 to avoid downstream z-score division by zero.
    expect(r.stddev).toBe(1.0)
  })
})
