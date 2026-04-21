import { describe, expect, it } from 'vitest'
import { entityQualifies } from '@/lib/gap-score/candidate-generator'

function aggregate(opts: {
  streams: string[]
  maxSeverity: number
  fireIds?: string[]
  triggerTypes?: string[]
}) {
  return {
    streams: new Set(opts.streams),
    maxSeverity: opts.maxSeverity,
    fireIds: opts.fireIds ?? ['ev1'],
    triggerTypes: new Set(opts.triggerTypes ?? ['T-GT1']),
  }
}

describe('candidate generator — entityQualifies', () => {
  const FEATURED = new Set(['ent-featured'])

  it('disqualifies when no fires in window', () => {
    expect(
      entityQualifies(
        'ent-A',
        { streams: new Set(), maxSeverity: 0, fireIds: [], triggerTypes: new Set() },
        FEATURED,
      ),
    ).toBe(false)
  })

  it('qualifies featured entity on any fire (bypass rule)', () => {
    expect(
      entityQualifies(
        'ent-featured',
        aggregate({ streams: ['narrative'], maxSeverity: 0.1 }),
        FEATURED,
      ),
    ).toBe(true)
  })

  it('qualifies on single high-severity fire (max-severity rule)', () => {
    expect(
      entityQualifies(
        'ent-A',
        aggregate({ streams: ['narrative'], maxSeverity: 0.8 }),
        FEATURED,
      ),
    ).toBe(true)
  })

  it('disqualifies single low-severity fire in one stream', () => {
    expect(
      entityQualifies(
        'ent-A',
        aggregate({ streams: ['narrative'], maxSeverity: 0.3 }),
        FEATURED,
      ),
    ).toBe(false)
  })

  it('qualifies on ≥2 distinct streams (dedup-by-stream rule)', () => {
    expect(
      entityQualifies(
        'ent-A',
        aggregate({ streams: ['narrative', 'ground_truth'], maxSeverity: 0.3 }),
        FEATURED,
      ),
    ).toBe(true)
  })

  it('single stream with MANY fires does NOT qualify (dedup-by-stream)', () => {
    // 5 narrative fires → still just 1 stream
    expect(
      entityQualifies(
        'ent-A',
        aggregate({
          streams: ['narrative'],
          maxSeverity: 0.3,
          fireIds: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'],
          triggerTypes: ['T-N1', 'T-N2', 'T-N3', 'T-N4'],
        }),
        FEATURED,
      ),
    ).toBe(false)
  })

  it('uses MAX severity across all fires for high-severity check', () => {
    // 3 fires on narrative only: 0.2, 0.3, 0.9 — max is 0.9, qualifies via max-severity
    expect(
      entityQualifies(
        'ent-A',
        aggregate({
          streams: ['narrative'],
          maxSeverity: 0.9,
          fireIds: ['ev1', 'ev2', 'ev3'],
        }),
        FEATURED,
      ),
    ).toBe(true)
  })

  it('severity exactly at 0.7 threshold qualifies', () => {
    expect(
      entityQualifies(
        'ent-A',
        aggregate({ streams: ['narrative'], maxSeverity: 0.7 }),
        FEATURED,
      ),
    ).toBe(true)
  })
})
