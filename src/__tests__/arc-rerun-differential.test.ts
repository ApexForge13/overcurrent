/**
 * Tests for the Flag 2 (arc_rerun_differential) helpers that live in
 * lib/arc-rerun-differential.ts:
 *
 *   - pickStabilityCheckSample(items, rate, seed) \u2014 deterministic per-seed
 *     subset; sample size = max(1, round(N*rate)) when N > 0; empty in \u2192 empty out.
 *
 *   - applyNoveltyToPaths(classified, novelty, sample, flags) \u2014 overrides
 *     assignedPath to 'haiku_summary' for continuing-coverage sources NOT in
 *     the stability sample, EXCEPT tier-1 sources (which the assertion
 *     protects: they always keep full_debate). When Flag 2 is off, returns
 *     the input classifications unchanged.
 */

import { describe, it, expect } from 'vitest'
import {
  pickStabilityCheckSample,
  applyNoveltyToPaths,
  findArcRerunBaseline,
  STABILITY_SAMPLE_RATE,
  type NoveltyByUrl,
  type BaselineFetcher,
  type BaselineCandidate,
} from '@/lib/arc-rerun-differential'
import { resolveFlags, type DebatePath } from '@/lib/pipeline-flags'

// ---------------------------------------------------------------------------
// pickStabilityCheckSample \u2014 deterministic seeded subset
// ---------------------------------------------------------------------------

describe('pickStabilityCheckSample', () => {
  const TEN_ITEMS = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}` }))

  it('exposes the default rate as a constant (0.20)', () => {
    expect(STABILITY_SAMPLE_RATE).toBe(0.20)
  })

  it('returns empty for empty input regardless of rate or seed', () => {
    expect(pickStabilityCheckSample([], 0.20, 'seed-x')).toEqual([])
    expect(pickStabilityCheckSample([], 1.0, 'seed-y')).toEqual([])
  })

  it('returns floor-ceiling sample of round(N*rate)', () => {
    // 10 * 0.20 = 2.0 \u2192 sample 2
    const sample = pickStabilityCheckSample(TEN_ITEMS, 0.20, 'seed-1')
    expect(sample).toHaveLength(2)
  })

  it('always returns at least 1 when N > 0 (never zero sample per the plan)', () => {
    // 1 * 0.20 = 0.2 \u2192 round to 0; clamp to 1
    const sample = pickStabilityCheckSample([{ id: 'only' }], 0.20, 'seed-1')
    expect(sample).toEqual([{ id: 'only' }])
  })

  it('clamps sample size to N (cannot sample more than exists)', () => {
    const sample = pickStabilityCheckSample(TEN_ITEMS, 5.0, 'seed-1')
    expect(sample).toHaveLength(10)
  })

  it('is deterministic: same seed + same items \u2192 same sample', () => {
    const a = pickStabilityCheckSample(TEN_ITEMS, 0.30, 'seed-deterministic')
    const b = pickStabilityCheckSample(TEN_ITEMS, 0.30, 'seed-deterministic')
    expect(a).toEqual(b)
  })

  it('different seeds produce different samples (probabilistic)', () => {
    // With 10 items and 3-sample size, seeds with different hashes will
    // very likely pick different subsets. We assert the result for two
    // specific seeds differs in at least one element.
    const a = pickStabilityCheckSample(TEN_ITEMS, 0.30, 'seed-A-totally-different')
    const b = pickStabilityCheckSample(TEN_ITEMS, 0.30, 'seed-B-completely-other')
    const aIds = new Set(a.map((x) => x.id))
    const bIds = new Set(b.map((x) => x.id))
    let overlap = 0
    for (const id of aIds) if (bIds.has(id)) overlap++
    // Not strictly enforced equal, just must not be a perfect match
    expect(overlap).toBeLessThan(3)
  })

  it('does not mutate the input array', () => {
    const original = [...TEN_ITEMS]
    pickStabilityCheckSample(TEN_ITEMS, 0.30, 'seed-1')
    expect(TEN_ITEMS).toEqual(original)
  })

  it('all sampled items exist in the original input', () => {
    const sample = pickStabilityCheckSample(TEN_ITEMS, 0.50, 'seed-z')
    const ids = new Set(TEN_ITEMS.map((i) => i.id))
    for (const s of sample) expect(ids.has(s.id)).toBe(true)
  })

  it('produces a sample of unique items (no duplicates)', () => {
    const sample = pickStabilityCheckSample(TEN_ITEMS, 0.50, 'seed-dup-test')
    const ids = sample.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rate of 0 still returns at least 1 sample (per >0% guarantee)', () => {
    // Per the plan: "sample is random per arc rerun ... and >0% \u2014 never zero"
    // A rate of 0 is treated as "use the default rate" (or at minimum 1 item).
    const sample = pickStabilityCheckSample(TEN_ITEMS, 0, 'seed-1')
    expect(sample.length).toBeGreaterThanOrEqual(1)
  })

  it('preserves item types through sampling', () => {
    const items = [
      { url: 'a', tier: 'regional', extra: { nested: true } },
      { url: 'b', tier: 'national', extra: { nested: false } },
    ]
    const sample = pickStabilityCheckSample(items, 0.5, 'seed-type-test')
    expect(sample).toHaveLength(1)
    // Sampled item retains all original fields
    expect(typeof sample[0].extra).toBe('object')
  })
})

// ---------------------------------------------------------------------------
// applyNoveltyToPaths \u2014 override paths based on novelty, with tier-1 protection
// ---------------------------------------------------------------------------

describe('applyNoveltyToPaths', () => {
  // Each source carries: url, tier, assignedPath (from Flag 1 classification).
  type ClassifiedSource = { url: string; tier: string; assignedPath: DebatePath }

  const SIX_CLASSIFIED: ClassifiedSource[] = [
    { url: 'a', tier: 'wire_service', assignedPath: 'full_debate' },     // tier-1, continuing \u2192 KEEP full
    { url: 'b', tier: 'national',     assignedPath: 'full_debate' },     // tier-1, new \u2192 KEEP full
    { url: 'c', tier: 'specialty',    assignedPath: 'full_debate' },     // tier-1 (now), continuing \u2192 KEEP full
    { url: 'd', tier: 'regional',     assignedPath: 'two_model_debate' },// non-tier-1, continuing not sampled \u2192 \u2192 haiku
    { url: 'e', tier: 'emerging',     assignedPath: 'haiku_summary' },   // already haiku, continuing \u2192 unchanged
    { url: 'f', tier: 'unclassified', assignedPath: 'haiku_summary' },   // already haiku, new \u2192 unchanged
  ]

  it('Flag 2 OFF returns input unchanged', () => {
    const flags = resolveFlags({ env: { PIPELINE_ARC_RERUN_DIFFERENTIAL: '0' } })
    const novelty: NoveltyByUrl = {
      a: 'continuing_coverage', b: 'new_since_last_run', c: 'continuing_coverage',
      d: 'continuing_coverage', e: 'continuing_coverage', f: 'new_since_last_run',
    }
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, [], flags)
    expect(result).toEqual(SIX_CLASSIFIED) // identical
  })

  it('PIPELINE_FORCE_FULL_QUALITY=1 returns input unchanged', () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    const novelty: NoveltyByUrl = {
      a: 'continuing_coverage', b: 'continuing_coverage', c: 'continuing_coverage',
      d: 'continuing_coverage', e: 'continuing_coverage', f: 'continuing_coverage',
    }
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, [], flags)
    expect(result).toEqual(SIX_CLASSIFIED)
  })

  it('continuing non-tier-1 sources NOT in sample are demoted to haiku_summary', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = {
      a: 'continuing_coverage', b: 'new_since_last_run', c: 'continuing_coverage',
      d: 'continuing_coverage', e: 'continuing_coverage', f: 'new_since_last_run',
    }
    const sample: string[] = [] // nothing sampled
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, sample, flags)
    // a (tier-1 continuing) \u2192 still full
    expect(result.find((r) => r.url === 'a')!.assignedPath).toBe('full_debate')
    // b (tier-1 new) \u2192 still full
    expect(result.find((r) => r.url === 'b')!.assignedPath).toBe('full_debate')
    // c (specialty=tier-1 continuing) \u2192 still full
    expect(result.find((r) => r.url === 'c')!.assignedPath).toBe('full_debate')
    // d (regional continuing, not sampled) \u2192 demoted to haiku
    expect(result.find((r) => r.url === 'd')!.assignedPath).toBe('haiku_summary')
    // e (emerging continuing) \u2192 already haiku (no-op)
    expect(result.find((r) => r.url === 'e')!.assignedPath).toBe('haiku_summary')
    // f (unclassified new) \u2192 already haiku (no-op)
    expect(result.find((r) => r.url === 'f')!.assignedPath).toBe('haiku_summary')
  })

  it('continuing non-tier-1 sources IN sample keep their tier-based path (full or two_model)', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = {
      a: 'continuing_coverage', b: 'continuing_coverage', c: 'continuing_coverage',
      d: 'continuing_coverage', e: 'continuing_coverage', f: 'continuing_coverage',
    }
    const sample = ['d'] // sample d (regional)
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, sample, flags)
    // d sampled \u2192 keeps two_model_debate
    expect(result.find((r) => r.url === 'd')!.assignedPath).toBe('two_model_debate')
    // tier-1s unchanged
    expect(result.find((r) => r.url === 'a')!.assignedPath).toBe('full_debate')
  })

  it('new sources keep their tier-based path regardless of sample membership', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = {
      a: 'new_since_last_run', b: 'new_since_last_run', c: 'new_since_last_run',
      d: 'new_since_last_run', e: 'new_since_last_run', f: 'new_since_last_run',
    }
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, [], flags)
    // All paths preserved: nothing was continuing, so no override happens
    expect(result.map((r) => r.assignedPath)).toEqual(
      SIX_CLASSIFIED.map((s) => s.assignedPath),
    )
  })

  it('missing novelty entry defaults to continuing_coverage (non-sampled \u2192 haiku for non-tier-1)', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = { a: 'new_since_last_run' } // only one entry
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, [], flags)
    // d (regional, defaulted to continuing, not sampled) \u2192 haiku
    expect(result.find((r) => r.url === 'd')!.assignedPath).toBe('haiku_summary')
  })

  it('preserves source ordering and never returns extra/missing items', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = {
      a: 'continuing_coverage', b: 'continuing_coverage', c: 'continuing_coverage',
      d: 'continuing_coverage', e: 'continuing_coverage', f: 'continuing_coverage',
    }
    const result = applyNoveltyToPaths(SIX_CLASSIFIED, novelty, [], flags)
    expect(result.map((r) => r.url)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('non-negotiable assertion fires if a tier-1 ever gets demoted (defensive)', () => {
    // The function MUST keep tier-1 at full_debate. To prove the assertion
    // backstop works, we hand-build a misclassified input (assignedPath
    // already wrong) and confirm the result still passes through to assertion.
    // Note: applyNoveltyToPaths itself never demotes tier-1, so this test
    // verifies the safety net by feeding a pre-broken input.
    const flags = resolveFlags({ env: {} })
    const broken = [
      { url: 'a', tier: 'wire_service', assignedPath: 'haiku_summary' as DebatePath }, // already wrong!
    ]
    const novelty: NoveltyByUrl = { a: 'continuing_coverage' }
    expect(() => applyNoveltyToPaths(broken, novelty, [], flags)).toThrow(/NON-NEGOTIABLE VIOLATION/)
  })
})

// ---------------------------------------------------------------------------
// findArcRerunBaseline \u2014 picks most recent prior arc analysis from cluster
// ---------------------------------------------------------------------------

describe('findArcRerunBaseline', () => {
  it('returns null when storyClusterId is null (e.g., standalone analysis)', async () => {
    const fetcher: BaselineFetcher = async () => []
    const result = await findArcRerunBaseline(null, undefined, fetcher)
    expect(result).toBeNull()
  })

  it('returns null when cluster has no prior arc analyses', async () => {
    const fetcher: BaselineFetcher = async () => [] // cluster exists but no qualifying stories
    const result = await findArcRerunBaseline('cluster-x', undefined, fetcher)
    expect(result).toBeNull()
  })

  it('returns the most recent prior arc analysis (sorted by createdAt desc)', async () => {
    const candidates: BaselineCandidate[] = [
      { id: 'old',    createdAt: new Date('2026-04-10T00:00:00Z'), headline: 'Old run',    keyClaims: ['old claim'],    analysisType: 'new_arc' },
      { id: 'recent', createdAt: new Date('2026-04-15T00:00:00Z'), headline: 'Recent run', keyClaims: ['recent claim'], analysisType: 'arc_rerun' },
      { id: 'mid',    createdAt: new Date('2026-04-12T00:00:00Z'), headline: 'Mid run',    keyClaims: ['mid claim'],    analysisType: 'arc_rerun' },
    ]
    const fetcher: BaselineFetcher = async () => candidates
    const result = await findArcRerunBaseline('cluster-x', undefined, fetcher)
    expect(result).not.toBeNull()
    expect(result!.previousAnalysisCreatedAt.toISOString()).toBe('2026-04-15T00:00:00.000Z')
    expect(result!.previousHeadline).toBe('Recent run')
    expect(result!.previousKeyClaims).toEqual(['recent claim'])
  })

  it('excludes the current story when excludeStoryId is provided', async () => {
    const candidates: BaselineCandidate[] = [
      { id: 'recent', createdAt: new Date('2026-04-15T00:00:00Z'), headline: 'Recent',    keyClaims: [], analysisType: 'arc_rerun' },
      { id: 'older',  createdAt: new Date('2026-04-12T00:00:00Z'), headline: 'Older',     keyClaims: [], analysisType: 'arc_rerun' },
    ]
    const fetcher: BaselineFetcher = async () => candidates
    const result = await findArcRerunBaseline('cluster-x', 'recent', fetcher)
    // 'recent' excluded \u2192 'older' wins
    expect(result!.previousHeadline).toBe('Older')
  })

  it('returns null when the only qualifying analysis is the excluded current story', async () => {
    const candidates: BaselineCandidate[] = [
      { id: 'self', createdAt: new Date('2026-04-19T00:00:00Z'), headline: 'self', keyClaims: [], analysisType: 'arc_rerun' },
    ]
    const fetcher: BaselineFetcher = async () => candidates
    const result = await findArcRerunBaseline('cluster-x', 'self', fetcher)
    expect(result).toBeNull()
  })

  it('passes the storyClusterId through to the fetcher', async () => {
    let captured: string | null = null
    const fetcher: BaselineFetcher = async (cid) => {
      captured = cid
      return []
    }
    await findArcRerunBaseline('cluster-iran-hormuz', undefined, fetcher)
    expect(captured).toBe('cluster-iran-hormuz')
  })

  it('caps key claims at 8 (prompt size guard) and trims whitespace', async () => {
    const longClaims = Array.from({ length: 20 }, (_, i) => `   claim ${i + 1}   `)
    const candidates: BaselineCandidate[] = [
      { id: 'r', createdAt: new Date('2026-04-15T00:00:00Z'), headline: 'h', keyClaims: longClaims, analysisType: 'arc_rerun' },
    ]
    const fetcher: BaselineFetcher = async () => candidates
    const result = await findArcRerunBaseline('cluster-x', undefined, fetcher)
    expect(result!.previousKeyClaims).toHaveLength(8)
    expect(result!.previousKeyClaims[0]).toBe('claim 1') // trimmed
  })

  it('handles candidates with empty keyClaims gracefully (returns empty array)', async () => {
    const candidates: BaselineCandidate[] = [
      { id: 'r', createdAt: new Date('2026-04-15T00:00:00Z'), headline: 'h', keyClaims: [], analysisType: 'arc_rerun' },
    ]
    const fetcher: BaselineFetcher = async () => candidates
    const result = await findArcRerunBaseline('cluster-x', undefined, fetcher)
    expect(result!.previousKeyClaims).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Flag 2 orchestration: classify \u2192 sample \u2192 applyNoveltyToPaths integration
// ---------------------------------------------------------------------------

describe('Flag 2 orchestration: classify \u2192 sample \u2192 override', () => {
  // Reuse the SIX_CLASSIFIED structure that mirrors the real pipeline state
  // immediately after assignSourcesByTier. Each entry: tier-based path that
  // Flag 2 may or may not override.
  const SIX_TIER_CLASSIFIED = [
    { url: 'wire-1', tier: 'wire_service', assignedPath: 'full_debate' as DebatePath },
    { url: 'national-1', tier: 'national', assignedPath: 'full_debate' as DebatePath },
    { url: 'specialty-1', tier: 'specialty', assignedPath: 'full_debate' as DebatePath },
    { url: 'regional-1', tier: 'regional', assignedPath: 'two_model_debate' as DebatePath },
    { url: 'regional-2', tier: 'regional', assignedPath: 'two_model_debate' as DebatePath },
    { url: 'unclassified-1', tier: 'unclassified', assignedPath: 'haiku_summary' as DebatePath },
  ]

  it('end-to-end: 6-source set with novelty classification, 20% sample, override applied', () => {
    const flags = resolveFlags({ env: {} })
    // Synthetic novelty: 4 continuing, 2 new
    const novelty: NoveltyByUrl = {
      'wire-1':         'continuing_coverage', // tier-1 protected
      'national-1':     'new_since_last_run',
      'specialty-1':    'continuing_coverage', // tier-1 protected (specialty promoted)
      'regional-1':     'continuing_coverage', // candidate for demotion
      'regional-2':     'continuing_coverage', // candidate for demotion
      'unclassified-1': 'continuing_coverage', // already haiku
    }
    // Sample 20% of the 4 continuing sources \u2192 round(4*0.20) = 1
    const continuingUrls = Object.entries(novelty)
      .filter(([, n]) => n === 'continuing_coverage')
      .map(([url]) => url)
    const sample = pickStabilityCheckSample(continuingUrls, STABILITY_SAMPLE_RATE, 'arc-root-test')
    expect(sample).toHaveLength(1)

    const result = applyNoveltyToPaths(SIX_TIER_CLASSIFIED, novelty, sample.map((u) => u), flags)

    // Tier-1 sources unaffected
    expect(result.find((r) => r.url === 'wire-1')!.assignedPath).toBe('full_debate')
    expect(result.find((r) => r.url === 'national-1')!.assignedPath).toBe('full_debate')
    expect(result.find((r) => r.url === 'specialty-1')!.assignedPath).toBe('full_debate')

    // Regional continuing: demoted to haiku UNLESS in sample
    const regional1Final = result.find((r) => r.url === 'regional-1')!.assignedPath
    const regional2Final = result.find((r) => r.url === 'regional-2')!.assignedPath
    // Exactly one of regional-1 / regional-2 should be in sample (sample size = 1)
    const sampleSet = new Set(sample)
    if (sampleSet.has('regional-1')) {
      expect(regional1Final).toBe('two_model_debate')
      expect(regional2Final).toBe('haiku_summary')
    } else if (sampleSet.has('regional-2')) {
      expect(regional2Final).toBe('two_model_debate')
      expect(regional1Final).toBe('haiku_summary')
    }

    // Unclassified continuing already at haiku \u2014 no change
    expect(result.find((r) => r.url === 'unclassified-1')!.assignedPath).toBe('haiku_summary')
  })

  it('all-new-sources case: zero sources demoted, cost-savings opportunity is zero', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = {
      'wire-1': 'new_since_last_run', 'national-1': 'new_since_last_run',
      'specialty-1': 'new_since_last_run', 'regional-1': 'new_since_last_run',
      'regional-2': 'new_since_last_run', 'unclassified-1': 'new_since_last_run',
    }
    const result = applyNoveltyToPaths(SIX_TIER_CLASSIFIED, novelty, [], flags)
    // No paths changed
    for (const c of SIX_TIER_CLASSIFIED) {
      expect(result.find((r) => r.url === c.url)!.assignedPath).toBe(c.assignedPath)
    }
  })

  it('all-continuing case: every non-tier-1 sourcable for demotion (sample protects ~20%)', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = Object.fromEntries(
      SIX_TIER_CLASSIFIED.map((s) => [s.url, 'continuing_coverage' as const]),
    )
    // Sample 20% of all 6 \u2192 round(6*0.20) = 1
    const sample = pickStabilityCheckSample(
      SIX_TIER_CLASSIFIED.filter((s) => !['wire_service', 'national', 'specialty'].includes(s.tier)).map((s) => s.url),
      STABILITY_SAMPLE_RATE,
      'all-continuing-seed',
    )
    const result = applyNoveltyToPaths(SIX_TIER_CLASSIFIED, novelty, sample, flags)
    // Tier-1: all preserved
    expect(result.filter((r) => ['wire_service', 'national', 'specialty'].includes(r.tier)).every((r) => r.assignedPath === 'full_debate')).toBe(true)
    // Of the 2 regionals: at least 1 demoted to haiku (sample protects at most 1)
    const regionals = result.filter((r) => r.tier === 'regional')
    const demotedRegionals = regionals.filter((r) => r.assignedPath === 'haiku_summary')
    expect(demotedRegionals.length).toBeGreaterThanOrEqual(1)
  })

  it('seed reproducibility: same seed + same continuing list \u2192 same demotion set', () => {
    const flags = resolveFlags({ env: {} })
    const novelty: NoveltyByUrl = {
      'regional-1': 'continuing_coverage', 'regional-2': 'continuing_coverage',
      'wire-1': 'new_since_last_run', 'national-1': 'new_since_last_run',
      'specialty-1': 'new_since_last_run', 'unclassified-1': 'new_since_last_run',
    }
    const continuingUrls = ['regional-1', 'regional-2']
    const sampleA = pickStabilityCheckSample(continuingUrls, STABILITY_SAMPLE_RATE, 'arc-root-deterministic')
    const sampleB = pickStabilityCheckSample(continuingUrls, STABILITY_SAMPLE_RATE, 'arc-root-deterministic')
    expect(sampleA).toEqual(sampleB)
    const resultA = applyNoveltyToPaths(SIX_TIER_CLASSIFIED, novelty, sampleA, flags)
    const resultB = applyNoveltyToPaths(SIX_TIER_CLASSIFIED, novelty, sampleB, flags)
    expect(resultA.map((r) => r.assignedPath)).toEqual(resultB.map((r) => r.assignedPath))
  })

  it('Flag 2 OFF + arc_rerun: no override, all paths preserved (Flag 1 still active)', () => {
    const flags = resolveFlags({ env: { PIPELINE_ARC_RERUN_DIFFERENTIAL: '0' } })
    const novelty: NoveltyByUrl = {
      'regional-1': 'continuing_coverage', 'regional-2': 'continuing_coverage',
    }
    const result = applyNoveltyToPaths(SIX_TIER_CLASSIFIED, novelty, [], flags)
    expect(result).toEqual(SIX_TIER_CLASSIFIED)
  })
})
