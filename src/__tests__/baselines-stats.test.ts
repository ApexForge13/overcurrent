import { describe, expect, it } from 'vitest'
import { computeStats, zScore } from '@/lib/baselines/stats'

describe('computeStats', () => {
  it('empty input returns zero stats', () => {
    expect(computeStats([])).toEqual({ mean: 0, stddev: 0, count: 0 })
  })

  it('single observation returns stddev=0', () => {
    expect(computeStats([42])).toEqual({ mean: 42, stddev: 0, count: 1 })
  })

  it('identical observations return stddev=0', () => {
    const stats = computeStats([5, 5, 5, 5])
    expect(stats.mean).toBe(5)
    expect(stats.stddev).toBe(0)
    expect(stats.count).toBe(4)
  })

  it('computes population stddev (N, not N-1)', () => {
    // For [2, 4, 4, 4, 5, 5, 7, 9]: mean = 5, population stddev = 2
    const stats = computeStats([2, 4, 4, 4, 5, 5, 7, 9])
    expect(stats.mean).toBe(5)
    expect(stats.stddev).toBeCloseTo(2, 10)
    expect(stats.count).toBe(8)
  })

  it('handles negative values', () => {
    const stats = computeStats([-3, -1, 1, 3])
    expect(stats.mean).toBe(0)
    expect(stats.stddev).toBeCloseTo(Math.sqrt(5), 10)
  })

  it('handles large values without overflow', () => {
    const stats = computeStats([1e9, 2e9, 3e9])
    expect(stats.mean).toBe(2e9)
    expect(stats.stddev).toBeGreaterThan(0)
  })
})

describe('zScore', () => {
  it('returns 0 when stddev is 0', () => {
    expect(zScore(10, { mean: 5, stddev: 0, count: 3 })).toBe(0)
  })

  it('computes z-score correctly', () => {
    expect(zScore(10, { mean: 5, stddev: 2.5, count: 10 })).toBe(2)
  })

  it('returns negative z-score below mean', () => {
    expect(zScore(0, { mean: 5, stddev: 2.5, count: 10 })).toBe(-2)
  })
})
