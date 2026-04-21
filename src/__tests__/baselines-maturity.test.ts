import { describe, expect, it } from 'vitest'
import { MATURITY_THRESHOLDS, isMature, minSampleSize } from '@/lib/baselines/maturity'

describe('baseline maturity', () => {
  it('MATURITY_THRESHOLDS includes entries for all expected metrics', () => {
    const keys = Object.keys(MATURITY_THRESHOLDS)
    expect(keys).toContain('article_volume_hourly')
    expect(keys).toContain('cashtag_velocity_hourly')
    expect(keys).toContain('tankerCount')
    expect(keys).toContain('macro_surprise')
  })

  it('minSampleSize returns threshold for known metric', () => {
    expect(minSampleSize('tankerCount')).toBe(90)
    expect(minSampleSize('cashtag_velocity_hourly')).toBe(240)
  })

  it('minSampleSize returns conservative default (100) for unknown metric', () => {
    expect(minSampleSize('invented_metric_12345')).toBe(100)
  })

  it('isMature returns false below threshold', () => {
    expect(isMature('tankerCount', 89)).toBe(false)
    expect(isMature('tankerCount', 0)).toBe(false)
  })

  it('isMature returns true at and above threshold', () => {
    expect(isMature('tankerCount', 90)).toBe(true)
    expect(isMature('tankerCount', 10_000)).toBe(true)
  })

  it('maritime metrics all share the 90-sample floor', () => {
    expect(MATURITY_THRESHOLDS.tankerCount).toBe(90)
    expect(MATURITY_THRESHOLDS.containerShipCount).toBe(90)
    expect(MATURITY_THRESHOLDS.bulkCarrierCount).toBe(90)
    expect(MATURITY_THRESHOLDS.lngCarrierCount).toBe(90)
  })
})
