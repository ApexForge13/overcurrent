/**
 * Tests for the Flag 5 (regional_debate_pooling) per-region top-N cap.
 *
 * Operates per-region, after Flag 1 tier classification (and on top of any
 * Flag 2/3 pathOverrides already applied). Caps the full-debate (or
 * two-model debate) pool at REGIONAL_POOL_CAP sources per region. Sources
 * beyond the cap are demoted to haiku_summary, EXCEPT tier-1 sources which
 * are protected by assertTier1FullDebate.
 *
 * Sort order for the cap (deterministic):
 *   1. Tier rank ascending (wire_service > national > specialty > regional > emerging > unclassified)
 *   2. publishedAt ascending (earliest first; missing values sort last)
 *   3. URL ascending (deterministic tie-break \u2014 Source.id is not yet assigned at dispatch time)
 */

import { describe, it, expect } from 'vitest'
import {
  applyRegionalPooling,
  REGIONAL_POOL_CAP,
  TIER_RANK,
  type ClassifiedPoolSource,
} from '@/lib/regional-debate-pooling'
import { resolveFlags, type DebatePath } from '@/lib/pipeline-flags'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('REGIONAL_POOL_CAP', () => {
  it('starts at 8 per the user spec', () => {
    expect(REGIONAL_POOL_CAP).toBe(8)
  })
})

describe('TIER_RANK', () => {
  it('orders tiers from highest priority to lowest (lower rank = higher priority)', () => {
    expect(TIER_RANK.wire_service).toBeLessThan(TIER_RANK.national)
    expect(TIER_RANK.national).toBeLessThan(TIER_RANK.specialty)
    expect(TIER_RANK.specialty).toBeLessThan(TIER_RANK.regional)
    expect(TIER_RANK.regional).toBeLessThan(TIER_RANK.emerging)
    expect(TIER_RANK.emerging).toBeLessThan(TIER_RANK.unclassified)
  })

  it('has explicit ranks for all 6 known tiers', () => {
    expect(typeof TIER_RANK.wire_service).toBe('number')
    expect(typeof TIER_RANK.national).toBe('number')
    expect(typeof TIER_RANK.specialty).toBe('number')
    expect(typeof TIER_RANK.regional).toBe('number')
    expect(typeof TIER_RANK.emerging).toBe('number')
    expect(typeof TIER_RANK.unclassified).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// applyRegionalPooling \u2014 the cap behavior
// ---------------------------------------------------------------------------

function src(
  url: string,
  tier: string,
  assignedPath: DebatePath,
  publishedAt?: string,
): ClassifiedPoolSource {
  return { url, tier, assignedPath, publishedAt }
}

describe('applyRegionalPooling \u2014 flag-off and force-full', () => {
  it('Flag 5 OFF returns input unchanged', () => {
    const flags = resolveFlags({ env: { PIPELINE_REGIONAL_DEBATE_POOLING: '0' } })
    const sources = Array.from({ length: 12 }, (_, i) =>
      src(`url-${i}`, 'regional', 'two_model_debate'),
    )
    const result = applyRegionalPooling(sources, flags)
    expect(result).toEqual(sources)
  })

  it('PIPELINE_FORCE_FULL_QUALITY=1 returns input unchanged', () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    const sources = Array.from({ length: 12 }, (_, i) =>
      src(`url-${i}`, 'regional', 'two_model_debate'),
    )
    const result = applyRegionalPooling(sources, flags)
    expect(result).toEqual(sources)
  })
})

describe('applyRegionalPooling \u2014 cap behavior', () => {
  it('returns input unchanged when source count <= cap', () => {
    const flags = resolveFlags({ env: {} })
    const sources = [
      src('a', 'regional', 'two_model_debate'),
      src('b', 'regional', 'two_model_debate'),
      src('c', 'emerging', 'haiku_summary'),
    ]
    const result = applyRegionalPooling(sources, flags)
    expect(result).toEqual(sources)
  })

  it('returns input unchanged when source count exactly equals cap', () => {
    const flags = resolveFlags({ env: {} })
    const sources = Array.from({ length: REGIONAL_POOL_CAP }, (_, i) =>
      src(`url-${i}`, 'regional', 'two_model_debate'),
    )
    const result = applyRegionalPooling(sources, flags)
    expect(result.every((r) => r.assignedPath === 'two_model_debate')).toBe(true)
  })

  it('demotes non-tier-1 sources beyond top-8 to haiku_summary', () => {
    const flags = resolveFlags({ env: {} })
    // 10 regional sources, all in two-model. Top 8 keep, last 2 \u2192 haiku.
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(`url-${String(i).padStart(2, '0')}`, 'regional', 'two_model_debate'),
    )
    const result = applyRegionalPooling(sources, flags)
    // Sorted by tier rank (all same), publishedAt (all undefined), url asc.
    // url-00 ... url-09. Top 8 = url-00..url-07.
    expect(result.find((r) => r.url === 'url-00')!.assignedPath).toBe('two_model_debate')
    expect(result.find((r) => r.url === 'url-07')!.assignedPath).toBe('two_model_debate')
    expect(result.find((r) => r.url === 'url-08')!.assignedPath).toBe('haiku_summary')
    expect(result.find((r) => r.url === 'url-09')!.assignedPath).toBe('haiku_summary')
  })

  it('tier-1 sources are NEVER demoted, even when count exceeds cap', () => {
    const flags = resolveFlags({ env: {} })
    // 10 wire_service sources \u2014 all tier-1, must all stay full_debate
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(`url-${i}`, 'wire_service', 'full_debate'),
    )
    const result = applyRegionalPooling(sources, flags)
    expect(result.every((r) => r.assignedPath === 'full_debate')).toBe(true)
    // Also: assertion did not throw
  })

  it('tier-1 sources fill the cap; remaining tier-1 protected; non-tier-1 demoted', () => {
    const flags = resolveFlags({ env: {} })
    // 10 sources: 5 wire_service + 5 regional. Sort: wire_service (rank 0)
    // first, then regional (rank 3). Top 8 = 5 wire + 3 regional. Remaining
    // 2 regional are demoted.
    const sources = [
      src('wire-1', 'wire_service', 'full_debate'),
      src('wire-2', 'wire_service', 'full_debate'),
      src('wire-3', 'wire_service', 'full_debate'),
      src('wire-4', 'wire_service', 'full_debate'),
      src('wire-5', 'wire_service', 'full_debate'),
      src('reg-1', 'regional', 'two_model_debate'),
      src('reg-2', 'regional', 'two_model_debate'),
      src('reg-3', 'regional', 'two_model_debate'),
      src('reg-4', 'regional', 'two_model_debate'),
      src('reg-5', 'regional', 'two_model_debate'),
    ]
    const result = applyRegionalPooling(sources, flags)
    // All wire stay full
    for (let i = 1; i <= 5; i++) {
      expect(result.find((r) => r.url === `wire-${i}`)!.assignedPath).toBe('full_debate')
    }
    // First 3 regionals (alphabetical: reg-1, reg-2, reg-3) stay two_model
    expect(result.find((r) => r.url === 'reg-1')!.assignedPath).toBe('two_model_debate')
    expect(result.find((r) => r.url === 'reg-2')!.assignedPath).toBe('two_model_debate')
    expect(result.find((r) => r.url === 'reg-3')!.assignedPath).toBe('two_model_debate')
    // reg-4 and reg-5 demoted to haiku
    expect(result.find((r) => r.url === 'reg-4')!.assignedPath).toBe('haiku_summary')
    expect(result.find((r) => r.url === 'reg-5')!.assignedPath).toBe('haiku_summary')
  })

  it('20+ tier-1 sources alone all stay full (assertion protects, cap effectively bypassed for tier-1)', () => {
    const flags = resolveFlags({ env: {} })
    const sources = Array.from({ length: 20 }, (_, i) =>
      src(`url-${i}`, 'national', 'full_debate'),
    )
    expect(() => applyRegionalPooling(sources, flags)).not.toThrow()
    const result = applyRegionalPooling(sources, flags)
    expect(result.every((r) => r.assignedPath === 'full_debate')).toBe(true)
  })

  it('already-haiku sources beyond cap stay haiku (no-op, no double-demote)', () => {
    const flags = resolveFlags({ env: {} })
    const sources = Array.from({ length: 12 }, (_, i) =>
      src(`url-${String(i).padStart(2, '0')}`, 'emerging', 'haiku_summary'),
    )
    const result = applyRegionalPooling(sources, flags)
    expect(result.every((r) => r.assignedPath === 'haiku_summary')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sort order
// ---------------------------------------------------------------------------

describe('applyRegionalPooling \u2014 sort order: tier > publishedAt > url', () => {
  it('within same tier, earlier publishedAt wins', () => {
    const flags = resolveFlags({ env: {} })
    // 10 regional sources, mix of timestamps. Top 8 by earliest publishedAt.
    const sources = [
      src('reg-late-1', 'regional', 'two_model_debate', '2026-04-19T10:00:00Z'),
      src('reg-late-2', 'regional', 'two_model_debate', '2026-04-19T11:00:00Z'),
      src('reg-early-1', 'regional', 'two_model_debate', '2026-04-15T01:00:00Z'),
      src('reg-early-2', 'regional', 'two_model_debate', '2026-04-15T02:00:00Z'),
      src('reg-mid-1', 'regional', 'two_model_debate', '2026-04-17T05:00:00Z'),
      src('reg-mid-2', 'regional', 'two_model_debate', '2026-04-17T06:00:00Z'),
      src('reg-mid-3', 'regional', 'two_model_debate', '2026-04-17T07:00:00Z'),
      src('reg-mid-4', 'regional', 'two_model_debate', '2026-04-17T08:00:00Z'),
      src('reg-mid-5', 'regional', 'two_model_debate', '2026-04-17T09:00:00Z'),
      src('reg-mid-6', 'regional', 'two_model_debate', '2026-04-17T10:00:00Z'),
    ]
    const result = applyRegionalPooling(sources, flags)
    // The 2 latest (reg-late-1 and reg-late-2) should be demoted to haiku
    expect(result.find((r) => r.url === 'reg-late-1')!.assignedPath).toBe('haiku_summary')
    expect(result.find((r) => r.url === 'reg-late-2')!.assignedPath).toBe('haiku_summary')
    // The 2 earliest stay
    expect(result.find((r) => r.url === 'reg-early-1')!.assignedPath).toBe('two_model_debate')
    expect(result.find((r) => r.url === 'reg-early-2')!.assignedPath).toBe('two_model_debate')
  })

  it('missing publishedAt sorts LAST within tier (loses to sources with timestamps)', () => {
    const flags = resolveFlags({ env: {} })
    const sources = [
      src('reg-no-ts-1', 'regional', 'two_model_debate'),
      src('reg-no-ts-2', 'regional', 'two_model_debate'),
      src('reg-with-ts-1', 'regional', 'two_model_debate', '2026-04-15T01:00:00Z'),
      src('reg-with-ts-2', 'regional', 'two_model_debate', '2026-04-15T02:00:00Z'),
      src('reg-with-ts-3', 'regional', 'two_model_debate', '2026-04-15T03:00:00Z'),
      src('reg-with-ts-4', 'regional', 'two_model_debate', '2026-04-15T04:00:00Z'),
      src('reg-with-ts-5', 'regional', 'two_model_debate', '2026-04-15T05:00:00Z'),
      src('reg-with-ts-6', 'regional', 'two_model_debate', '2026-04-15T06:00:00Z'),
      src('reg-with-ts-7', 'regional', 'two_model_debate', '2026-04-15T07:00:00Z'),
      src('reg-with-ts-8', 'regional', 'two_model_debate', '2026-04-15T08:00:00Z'),
    ]
    const result = applyRegionalPooling(sources, flags)
    // 8 with timestamps fill the cap; 2 without timestamps demoted
    expect(result.find((r) => r.url === 'reg-no-ts-1')!.assignedPath).toBe('haiku_summary')
    expect(result.find((r) => r.url === 'reg-no-ts-2')!.assignedPath).toBe('haiku_summary')
  })

  it('within same tier+publishedAt, URL ascending tie-break (deterministic)', () => {
    const flags = resolveFlags({ env: {} })
    // 10 sources, identical tier + identical publishedAt. URL determines order.
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(`url-${String(i).padStart(2, '0')}`, 'regional', 'two_model_debate', '2026-04-15T00:00:00Z'),
    )
    const result = applyRegionalPooling(sources, flags)
    // url-00..07 stay (top 8 by URL asc); url-08 + url-09 demoted
    for (let i = 0; i <= 7; i++) {
      expect(result.find((r) => r.url === `url-${String(i).padStart(2, '0')}`)!.assignedPath).toBe('two_model_debate')
    }
    expect(result.find((r) => r.url === 'url-08')!.assignedPath).toBe('haiku_summary')
    expect(result.find((r) => r.url === 'url-09')!.assignedPath).toBe('haiku_summary')
  })

  it('determinism: same inputs run twice produce identical outputs', () => {
    const flags = resolveFlags({ env: {} })
    const sources: ClassifiedPoolSource[] = []
    // Build a mixed-tier 12-source set
    const tiers = ['national', 'regional', 'specialty', 'emerging', 'unclassified', 'wire_service']
    for (let i = 0; i < 12; i++) {
      const tier = tiers[i % tiers.length]
      const path: DebatePath =
        tier === 'wire_service' || tier === 'national' || tier === 'specialty' ? 'full_debate'
        : tier === 'regional' ? 'two_model_debate'
        : 'haiku_summary'
      sources.push(src(`url-${String(i).padStart(2, '0')}`, tier, path, `2026-04-${String(15 + (i % 5)).padStart(2, '0')}T00:00:00Z`))
    }
    const a = applyRegionalPooling(sources, flags)
    const b = applyRegionalPooling(sources, flags)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Edge cases + invariants
// ---------------------------------------------------------------------------

describe('applyRegionalPooling \u2014 edge cases', () => {
  it('handles empty input', () => {
    const flags = resolveFlags({ env: {} })
    expect(applyRegionalPooling([], flags)).toEqual([])
  })

  it('handles a single source', () => {
    const flags = resolveFlags({ env: {} })
    const single = [src('a', 'regional', 'two_model_debate')]
    expect(applyRegionalPooling(single, flags)).toEqual(single)
  })

  it('preserves input ordering in output (sort is for cap selection only, not output order)', () => {
    const flags = resolveFlags({ env: {} })
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(`url-${String(9 - i).padStart(2, '0')}`, 'regional', 'two_model_debate'),
    )
    // Input order: url-09, url-08, url-07, ..., url-00
    const result = applyRegionalPooling(sources, flags)
    expect(result.map((r) => r.url)).toEqual(sources.map((s) => s.url))
  })

  it('does not mutate input', () => {
    const flags = resolveFlags({ env: {} })
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(`url-${i}`, 'regional', 'two_model_debate'),
    )
    const snapshot = JSON.parse(JSON.stringify(sources))
    applyRegionalPooling(sources, flags)
    expect(sources).toEqual(snapshot)
  })

  it('counts demotions for caller-side telemetry', () => {
    const flags = resolveFlags({ env: {} })
    const sources = Array.from({ length: 12 }, (_, i) =>
      src(`url-${String(i).padStart(2, '0')}`, 'regional', 'two_model_debate'),
    )
    const result = applyRegionalPooling(sources, flags)
    let demoted = 0
    for (let i = 0; i < sources.length; i++) {
      if (sources[i].assignedPath !== result[i].assignedPath) demoted++
    }
    expect(demoted).toBe(4) // 12 - 8 = 4
  })

  it('non-negotiable: assertion fires on misclassified tier-1 input (defensive backstop)', () => {
    const flags = resolveFlags({ env: {} })
    const broken = [
      src('wire-broken', 'wire_service', 'haiku_summary'), // already wrong!
    ]
    expect(() => applyRegionalPooling(broken, flags)).toThrow(/NON-NEGOTIABLE VIOLATION/)
  })

  it('unknown tier sorts after all known tiers (treated as least priority)', () => {
    const flags = resolveFlags({ env: {} })
    // 8 known + 2 unknown. Known should fill the cap; unknown demoted.
    const sources = [
      src('reg-1', 'regional', 'two_model_debate'),
      src('reg-2', 'regional', 'two_model_debate'),
      src('reg-3', 'regional', 'two_model_debate'),
      src('reg-4', 'regional', 'two_model_debate'),
      src('reg-5', 'regional', 'two_model_debate'),
      src('reg-6', 'regional', 'two_model_debate'),
      src('reg-7', 'regional', 'two_model_debate'),
      src('reg-8', 'regional', 'two_model_debate'),
      src('mystery-1', 'totally_unknown_tier', 'haiku_summary'),
      src('mystery-2', 'another_unknown', 'haiku_summary'),
    ]
    const result = applyRegionalPooling(sources, flags)
    // All 8 regionals retained; unknown were already haiku_summary
    for (let i = 1; i <= 8; i++) {
      expect(result.find((r) => r.url === `reg-${i}`)!.assignedPath).toBe('two_model_debate')
    }
  })
})
