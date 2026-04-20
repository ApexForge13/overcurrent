/**
 * Tests for the Flag 3 (semantic_dedup) path override:
 *   - Constants (DEFAULT_UNIQUENESS_THRESHOLD = 4)
 *   - applyUniquenessToPaths: demotes non-tier-1 sources scoring below the
 *     threshold to haiku_summary; tier-1 protected via assertTier1FullDebate;
 *     flag-off no-op; force-full no-op; missing scores default to 10
 *     (conservative \u2014 keep in debate); preserves source ordering.
 */

import { describe, it, expect } from 'vitest'
import {
  applyUniquenessToPaths,
  DEFAULT_UNIQUENESS_THRESHOLD,
  type ScoresByUrl,
} from '@/lib/semantic-dedup'
import { resolveFlags, type DebatePath } from '@/lib/pipeline-flags'

type ClassifiedSource = { url: string; tier: string; assignedPath: DebatePath }

const SIX_CLASSIFIED: ClassifiedSource[] = [
  { url: 'a-wire',         tier: 'wire_service', assignedPath: 'full_debate' },        // tier-1 \u2014 protected
  { url: 'b-national',     tier: 'national',     assignedPath: 'full_debate' },        // tier-1 \u2014 protected
  { url: 'c-specialty',    tier: 'specialty',    assignedPath: 'full_debate' },        // tier-1 \u2014 protected
  { url: 'd-regional-hi',  tier: 'regional',     assignedPath: 'two_model_debate' },   // unique \u2192 keep
  { url: 'e-regional-lo',  tier: 'regional',     assignedPath: 'two_model_debate' },   // duplicate \u2192 demote
  { url: 'f-unclassified', tier: 'unclassified', assignedPath: 'haiku_summary' },      // already haiku \u2014 no-op
]

describe('DEFAULT_UNIQUENESS_THRESHOLD', () => {
  it('starts at 4 per the user spec (tunable as analyses accumulate)', () => {
    expect(DEFAULT_UNIQUENESS_THRESHOLD).toBe(4)
  })
})

describe('applyUniquenessToPaths', () => {
  it('Flag 3 OFF returns input unchanged', () => {
    const flags = resolveFlags({ env: { PIPELINE_SEMANTIC_DEDUP: '0' } })
    const scores: ScoresByUrl = { 'd-regional-hi': 8, 'e-regional-lo': 1, 'f-unclassified': 0 }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(result).toEqual(SIX_CLASSIFIED)
  })

  it('PIPELINE_FORCE_FULL_QUALITY=1 returns input unchanged', () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    const scores: ScoresByUrl = { 'd-regional-hi': 8, 'e-regional-lo': 1, 'f-unclassified': 0 }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(result).toEqual(SIX_CLASSIFIED)
  })

  it('demotes non-tier-1 sources scoring below threshold to haiku_summary', () => {
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = {
      'a-wire':         0,  // tier-1 \u2014 should NOT be demoted regardless
      'b-national':     2,  // tier-1 \u2014 protected
      'c-specialty':    1,  // tier-1 \u2014 protected
      'd-regional-hi':  8,  // above threshold \u2014 keep two_model_debate
      'e-regional-lo':  1,  // below threshold \u2014 demote to haiku
      'f-unclassified': 0,  // already haiku \u2014 no-op
    }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    // Tier-1 unaffected
    expect(result.find((r) => r.url === 'a-wire')!.assignedPath).toBe('full_debate')
    expect(result.find((r) => r.url === 'b-national')!.assignedPath).toBe('full_debate')
    expect(result.find((r) => r.url === 'c-specialty')!.assignedPath).toBe('full_debate')
    // Regional with high score \u2014 unchanged
    expect(result.find((r) => r.url === 'd-regional-hi')!.assignedPath).toBe('two_model_debate')
    // Regional with low score \u2014 demoted
    expect(result.find((r) => r.url === 'e-regional-lo')!.assignedPath).toBe('haiku_summary')
    // Already haiku \u2014 unchanged
    expect(result.find((r) => r.url === 'f-unclassified')!.assignedPath).toBe('haiku_summary')
  })

  it('boundary: score equal to threshold is KEPT (strict less-than comparison)', () => {
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = {
      'd-regional-hi':  4,  // == threshold, kept
      'e-regional-lo':  3,  // < threshold, demoted
    }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, 4, flags)
    expect(result.find((r) => r.url === 'd-regional-hi')!.assignedPath).toBe('two_model_debate')
    expect(result.find((r) => r.url === 'e-regional-lo')!.assignedPath).toBe('haiku_summary')
  })

  it('missing score defaults to 10 (conservative \u2014 unique, keep in debate)', () => {
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = {} // no scores at all
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    // No demotions happened
    expect(result).toEqual(SIX_CLASSIFIED)
  })

  it('preserves source ordering', () => {
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = { 'e-regional-lo': 0 }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(result.map((r) => r.url)).toEqual(['a-wire', 'b-national', 'c-specialty', 'd-regional-hi', 'e-regional-lo', 'f-unclassified'])
  })

  it('does not mutate the input array', () => {
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = { 'e-regional-lo': 0 }
    const original = JSON.parse(JSON.stringify(SIX_CLASSIFIED))
    applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(SIX_CLASSIFIED).toEqual(original)
  })

  it('respects custom threshold (e.g. 6 demotes more sources)', () => {
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = { 'd-regional-hi': 5, 'e-regional-lo': 7 }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, 6, flags)
    // d (score 5) is below threshold 6 \u2192 demoted
    expect(result.find((r) => r.url === 'd-regional-hi')!.assignedPath).toBe('haiku_summary')
    // e (score 7) is above threshold 6 \u2192 kept
    expect(result.find((r) => r.url === 'e-regional-lo')!.assignedPath).toBe('two_model_debate')
  })

  it('non-negotiable assertion fires on misclassified tier-1 input (defensive backstop)', () => {
    const flags = resolveFlags({ env: {} })
    const broken: ClassifiedSource[] = [
      { url: 'wire-broken', tier: 'wire_service', assignedPath: 'haiku_summary' }, // already wrong
    ]
    const scores: ScoresByUrl = { 'wire-broken': 10 }
    expect(() =>
      applyUniquenessToPaths(broken, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags),
    ).toThrow(/NON-NEGOTIABLE VIOLATION/)
  })

  it('handles empty input', () => {
    const flags = resolveFlags({ env: {} })
    expect(applyUniquenessToPaths([], {}, DEFAULT_UNIQUENESS_THRESHOLD, flags)).toEqual([])
  })

  it('counts demotions for caller-side telemetry', () => {
    // Caller-side helper logic: count sources where final path differs from
    // input path. This verifies the function makes that observable.
    const flags = resolveFlags({ env: {} })
    const scores: ScoresByUrl = {
      'd-regional-hi':  8,  // kept
      'e-regional-lo':  0,  // demoted
    }
    const result = applyUniquenessToPaths(SIX_CLASSIFIED, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    let demoted = 0
    for (let i = 0; i < SIX_CLASSIFIED.length; i++) {
      if (SIX_CLASSIFIED[i].assignedPath !== result[i].assignedPath) demoted++
    }
    expect(demoted).toBe(1)
  })
})
