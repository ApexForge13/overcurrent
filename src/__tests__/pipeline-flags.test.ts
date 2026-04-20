import { describe, it, expect } from 'vitest'
import {
  resolveFlags,
  assertTier1FullDebate,
  assertContestedClaimDebated,
  formatForceFullQualityWarning,
  buildFlagBreakdown,
  assignSourcePath,
  assignSourcesByTier,
  lookupSourceTiers,
  TIER_TO_PATH,
  ALL_FLAGS,
  type PipelineFlagName,
  type DebatePath,
  type TierFetcher,
} from '@/lib/pipeline-flags'

// ---------------------------------------------------------------------------
// resolveFlags() — defaults
// ---------------------------------------------------------------------------

describe('resolveFlags — defaults', () => {
  it('all five flags default ON when env is empty', () => {
    const flags = resolveFlags({ env: {} })
    expect(flags.tiered_source_processing).toBe(true)
    expect(flags.arc_rerun_differential).toBe(true)
    expect(flags.semantic_dedup).toBe(true)
    expect(flags.confidence_threshold_exit).toBe(true)
    expect(flags.regional_debate_pooling).toBe(true)
    expect(flags.forceFullQualityActive).toBe(false)
  })

  it('flagsActive contains all five names by default', () => {
    const flags = resolveFlags({ env: {} })
    expect(flags.flagsActive).toEqual([...ALL_FLAGS])
    expect(flags.flagsForcedOff).toEqual([])
  })

  it('omitting opts entirely behaves identically to env: {} when no env vars set', () => {
    // Capture and clear pipeline-related env vars for this test
    const saved: Record<string, string | undefined> = {}
    const keysToClear = [
      'PIPELINE_FORCE_FULL_QUALITY',
      'PIPELINE_TIERED_SOURCE_PROCESSING',
      'PIPELINE_ARC_RERUN_DIFFERENTIAL',
      'PIPELINE_SEMANTIC_DEDUP',
      'PIPELINE_CONFIDENCE_THRESHOLD_EXIT',
      'PIPELINE_REGIONAL_DEBATE_POOLING',
    ]
    for (const k of keysToClear) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    try {
      const flagsNoOpts = resolveFlags()
      const flagsEmptyEnv = resolveFlags({ env: {} })
      expect(flagsNoOpts).toEqual(flagsEmptyEnv)
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

// ---------------------------------------------------------------------------
// resolveFlags() — disabling individual flags via env
// ---------------------------------------------------------------------------

describe('resolveFlags — env var disables', () => {
  it('PIPELINE_TIERED_SOURCE_PROCESSING=0 disables flag 1 only', () => {
    const flags = resolveFlags({ env: { PIPELINE_TIERED_SOURCE_PROCESSING: '0' } })
    expect(flags.tiered_source_processing).toBe(false)
    expect(flags.arc_rerun_differential).toBe(true)
    expect(flags.semantic_dedup).toBe(true)
    expect(flags.confidence_threshold_exit).toBe(true)
    expect(flags.regional_debate_pooling).toBe(true)
    expect(flags.flagsForcedOff).toEqual(['tiered_source_processing'])
  })

  it.each(['0', 'false', 'FALSE', 'off', 'no', ' 0 ', 'No '])(
    'recognizes "%s" as disabled',
    (value) => {
      const flags = resolveFlags({ env: { PIPELINE_SEMANTIC_DEDUP: value } })
      expect(flags.semantic_dedup).toBe(false)
    },
  )

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'whatever'])(
    'recognizes "%s" as enabled',
    (value) => {
      const flags = resolveFlags({ env: { PIPELINE_SEMANTIC_DEDUP: value } })
      expect(flags.semantic_dedup).toBe(true)
    },
  )

  it('all five flags can be disabled simultaneously', () => {
    const flags = resolveFlags({
      env: {
        PIPELINE_TIERED_SOURCE_PROCESSING: '0',
        PIPELINE_ARC_RERUN_DIFFERENTIAL: '0',
        PIPELINE_SEMANTIC_DEDUP: '0',
        PIPELINE_CONFIDENCE_THRESHOLD_EXIT: '0',
        PIPELINE_REGIONAL_DEBATE_POOLING: '0',
      },
    })
    expect(flags.flagsActive).toEqual([])
    expect(flags.flagsForcedOff).toEqual([...ALL_FLAGS])
    expect(flags.forceFullQualityActive).toBe(false) // env disable ≠ force-full-quality
  })

  it('flagsActive and flagsForcedOff partition ALL_FLAGS exactly', () => {
    const flags = resolveFlags({
      env: {
        PIPELINE_TIERED_SOURCE_PROCESSING: '0',
        PIPELINE_REGIONAL_DEBATE_POOLING: '0',
      },
    })
    expect(flags.flagsActive.sort()).toEqual(
      ['arc_rerun_differential', 'semantic_dedup', 'confidence_threshold_exit'].sort() as PipelineFlagName[],
    )
    expect(flags.flagsForcedOff.sort()).toEqual(
      ['tiered_source_processing', 'regional_debate_pooling'].sort() as PipelineFlagName[],
    )
    // Union is exhaustive, intersection is empty
    const combined = new Set([...flags.flagsActive, ...flags.flagsForcedOff])
    expect(combined.size).toBe(ALL_FLAGS.length)
    for (const name of ALL_FLAGS) expect(combined.has(name)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveFlags() — PIPELINE_FORCE_FULL_QUALITY override
// ---------------------------------------------------------------------------

describe('resolveFlags — PIPELINE_FORCE_FULL_QUALITY override', () => {
  it('PIPELINE_FORCE_FULL_QUALITY=1 in env forces all five flags off', () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    expect(flags.tiered_source_processing).toBe(false)
    expect(flags.arc_rerun_differential).toBe(false)
    expect(flags.semantic_dedup).toBe(false)
    expect(flags.confidence_threshold_exit).toBe(false)
    expect(flags.regional_debate_pooling).toBe(false)
    expect(flags.forceFullQualityActive).toBe(true)
    expect(flags.flagsActive).toEqual([])
    expect(flags.flagsForcedOff).toEqual([...ALL_FLAGS])
  })

  it('opts.forceFullQuality=true overrides even when env has flag enables', () => {
    const flags = resolveFlags({
      forceFullQuality: true,
      env: {
        PIPELINE_TIERED_SOURCE_PROCESSING: '1',
        PIPELINE_SEMANTIC_DEDUP: '1',
        PIPELINE_REGIONAL_DEBATE_POOLING: '1',
      },
    })
    expect(flags.forceFullQualityActive).toBe(true)
    expect(flags.flagsActive).toEqual([])
  })

  it('opts.forceFullQuality=true wins over env PIPELINE_FORCE_FULL_QUALITY=0', () => {
    const flags = resolveFlags({
      forceFullQuality: true,
      env: { PIPELINE_FORCE_FULL_QUALITY: '0' },
    })
    expect(flags.forceFullQualityActive).toBe(true)
  })

  it('opts.forceFullQuality=false with env PIPELINE_FORCE_FULL_QUALITY=1 still resolves to forced (env wins when arg is not strictly true)', () => {
    // CLI default is undefined/false; env still controls the global default.
    // Per spec resolution order: opts.forceFullQuality === true wins, otherwise env applies.
    const flags = resolveFlags({
      forceFullQuality: false,
      env: { PIPELINE_FORCE_FULL_QUALITY: '1' },
    })
    expect(flags.forceFullQualityActive).toBe(true)
  })

  it('opts.forceFullQuality=undefined falls through to env (empty env → defaults on)', () => {
    const flags = resolveFlags({ forceFullQuality: undefined, env: {} })
    expect(flags.forceFullQualityActive).toBe(false)
    expect(flags.flagsActive.length).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// assertTier1FullDebate — non-negotiable #1
// ---------------------------------------------------------------------------

describe('assertTier1FullDebate', () => {
  it('passes silently when wire_service source gets full_debate', () => {
    expect(() =>
      assertTier1FullDebate({ tier: 'wire_service', assignedPath: 'full_debate' }, 'tiered_source_processing'),
    ).not.toThrow()
  })

  it('passes silently when national source gets full_debate', () => {
    expect(() =>
      assertTier1FullDebate({ tier: 'national', assignedPath: 'full_debate' }, 'tiered_source_processing'),
    ).not.toThrow()
  })

  it('passes silently for non-tier-1 sources at any path', () => {
    expect(() => assertTier1FullDebate({ tier: 'regional', assignedPath: 'two_model_debate' }, 'tiered_source_processing')).not.toThrow()
    expect(() => assertTier1FullDebate({ tier: 'emerging', assignedPath: 'haiku_summary' }, 'tiered_source_processing')).not.toThrow()
    expect(() => assertTier1FullDebate({ tier: 'unclassified', assignedPath: 'haiku_summary' }, 'regional_debate_pooling')).not.toThrow()
  })

  it.each([
    ['wire_service', 'two_model_debate'],
    ['wire_service', 'haiku_summary'],
    ['national', 'two_model_debate'],
    ['national', 'haiku_summary'],
    // ── Specialty promoted to Tier 1 (2026-04-19, after Flag 1 review) ──
    // Lloyd's List, S&P Global, Argus Media etc. carry the editorial signal
    // for clusters like Hormuz; demoting them silently would invert the finding.
    ['specialty', 'two_model_debate'],
    ['specialty', 'haiku_summary'],
  ] as const)('throws when tier=%s is assigned %s', (tier, path) => {
    expect(() =>
      assertTier1FullDebate({ tier, assignedPath: path }, 'tiered_source_processing'),
    ).toThrow(/NON-NEGOTIABLE VIOLATION/)
  })

  it('error message includes the offending tier, path, and the flag responsible', () => {
    let caught: Error | null = null
    try {
      assertTier1FullDebate({ tier: 'wire_service', assignedPath: 'haiku_summary' }, 'regional_debate_pooling')
    } catch (e) {
      caught = e as Error
    }
    expect(caught).not.toBeNull()
    expect(caught!.message).toContain("tier='wire_service'")
    expect(caught!.message).toContain("path='haiku_summary'")
    expect(caught!.message).toContain("flag='regional_debate_pooling'")
  })
})

// ---------------------------------------------------------------------------
// assertContestedClaimDebated — non-negotiable #2
// ---------------------------------------------------------------------------

describe('assertContestedClaimDebated', () => {
  it('passes silently when consensus claim skips cross-exam', () => {
    expect(() =>
      assertContestedClaimDebated({
        claimId: 'claim-42',
        isContested: false,
        willSkipCrossExam: true,
      }),
    ).not.toThrow()
  })

  it('passes silently when contested claim runs cross-exam', () => {
    expect(() =>
      assertContestedClaimDebated({
        claimId: 'claim-42',
        isContested: true,
        willSkipCrossExam: false,
      }),
    ).not.toThrow()
  })

  it('passes silently when neither contested nor skipped', () => {
    expect(() =>
      assertContestedClaimDebated({
        claimId: 'claim-42',
        isContested: false,
        willSkipCrossExam: false,
      }),
    ).not.toThrow()
  })

  it('throws when contested claim is about to skip cross-exam', () => {
    expect(() =>
      assertContestedClaimDebated({
        claimId: 'claim-42',
        isContested: true,
        willSkipCrossExam: true,
      }),
    ).toThrow(/NON-NEGOTIABLE VIOLATION/)
  })

  it('error message includes the claim id and names flag 4', () => {
    let caught: Error | null = null
    try {
      assertContestedClaimDebated({
        claimId: 'iran-nuclear-claim-7',
        isContested: true,
        willSkipCrossExam: true,
      })
    } catch (e) {
      caught = e as Error
    }
    expect(caught).not.toBeNull()
    expect(caught!.message).toContain("claim 'iran-nuclear-claim-7'")
    expect(caught!.message).toContain('confidence_threshold_exit')
  })
})

// ---------------------------------------------------------------------------
// formatForceFullQualityWarning — exact string
// ---------------------------------------------------------------------------

describe('formatForceFullQualityWarning', () => {
  it('returns the exact warning string', () => {
    const msg = formatForceFullQualityWarning()
    expect(msg).toContain('PIPELINE_FORCE_FULL_QUALITY active')
    expect(msg).toContain('all 5 cost-optimization flags')
    expect(msg).toContain('2-5x baseline')
  })
})

// ---------------------------------------------------------------------------
// buildFlagBreakdown — pure shape validation; no DB
// ---------------------------------------------------------------------------

describe('buildFlagBreakdown', () => {
  it('shape matches the spec when force-full is active (no savings)', () => {
    const flags = resolveFlags({ forceFullQuality: true, env: {} })
    const b = buildFlagBreakdown({
      storyId: 'story-123',
      flags,
      actualCostUsd: 28.5,
      estimatedFullCostUsd: 28.5,
    })
    expect(b.estimatedFullCostUsd).toBe(28.5)
    expect(b.actualCostUsd).toBe(28.5)
    expect(b.savingsUsd).toBe(0)
    expect(b.savingsPct).toBe(0)
    expect(b.flagsActive).toEqual([])
    expect(b.flagsForcedOff).toEqual([...ALL_FLAGS])
    expect(b.forceFullQualityActive).toBe(true)
    expect(b.sourcesFiltered).toEqual({
      below_uniqueness: 0,
      regional_pool_overflow: 0,
      tier_haiku_only: 0,
      tier_two_model_only: 0,
      arc_rerun_continuing: 0,
    })
  })

  it('computes savings + savingsPct correctly when flags reduced cost', () => {
    const flags = resolveFlags({ env: {} }) // all on
    const b = buildFlagBreakdown({
      storyId: 'story-456',
      flags,
      actualCostUsd: 11.75,
      estimatedFullCostUsd: 28.5,
      perFlagSavings: {
        tiered_source_processing: 6.20,
        semantic_dedup: 4.10,
        regional_debate_pooling: 6.45,
      },
      sourcesFiltered: {
        below_uniqueness: 14,
        regional_pool_overflow: 22,
        tier_haiku_only: 8,
      },
    })
    expect(b.savingsUsd).toBe(16.75)
    expect(b.savingsPct).toBe(58.8) // (16.75 / 28.5) * 100 ≈ 58.77 → rounded
    expect(b.perFlagSavings.tiered_source_processing).toBe(6.20)
    expect(b.sourcesFiltered.below_uniqueness).toBe(14)
    expect(b.forceFullQualityActive).toBe(false)
  })

  it('clamps negative savings to zero (actual > estimated)', () => {
    const flags = resolveFlags({ env: {} })
    const b = buildFlagBreakdown({
      storyId: null,
      flags,
      actualCostUsd: 30.0,
      estimatedFullCostUsd: 25.0,
    })
    expect(b.savingsUsd).toBe(0)
    expect(b.savingsPct).toBe(0)
  })

  it('handles zero estimated cost without divide-by-zero', () => {
    const flags = resolveFlags({ env: {} })
    const b = buildFlagBreakdown({
      storyId: null,
      flags,
      actualCostUsd: 0,
      estimatedFullCostUsd: 0,
    })
    expect(b.savingsPct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// FLAG 1 — tier-to-path mapping (TIER_TO_PATH constant)
// ---------------------------------------------------------------------------

describe('TIER_TO_PATH — Flag 1 tier classification map', () => {
  it('all six known tiers have an explicit path mapping', () => {
    expect(TIER_TO_PATH.wire_service).toBe('full_debate')
    expect(TIER_TO_PATH.national).toBe('full_debate')
    expect(TIER_TO_PATH.specialty).toBe('full_debate')
    expect(TIER_TO_PATH.regional).toBe('two_model_debate')
    expect(TIER_TO_PATH.emerging).toBe('haiku_summary')
    expect(TIER_TO_PATH.unclassified).toBe('haiku_summary')
  })

  it('the three tier-1-equivalent tiers all map to full_debate', () => {
    // Wire/national are non-negotiable. Specialty is editorially preserved
    // per the Hormuz cluster Standing Editorial Note (Lloyd\u2019s List, S&P
    // Global, Argus Media — specialist press as primary editorial signal).
    expect(TIER_TO_PATH.wire_service).toBe('full_debate')
    expect(TIER_TO_PATH.national).toBe('full_debate')
    expect(TIER_TO_PATH.specialty).toBe('full_debate')
  })
})

// ---------------------------------------------------------------------------
// FLAG 1 — assignSourcePath() — pure tier-string-in, path-out
// ---------------------------------------------------------------------------

describe('assignSourcePath — flag ON', () => {
  it.each([
    ['wire_service', 'full_debate'],
    ['national', 'full_debate'],
    ['specialty', 'full_debate'],
    ['regional', 'two_model_debate'],
    ['emerging', 'haiku_summary'],
    ['unclassified', 'haiku_summary'],
  ] as Array<[string, DebatePath]>)('tier=%s \u2192 %s when flag is on', (tier, expected) => {
    expect(assignSourcePath(tier, true)).toBe(expected)
  })

  it('unknown tier values default to haiku_summary (most conservative — no debate spend)', () => {
    expect(assignSourcePath('totally_made_up', true)).toBe('haiku_summary')
    expect(assignSourcePath('', true)).toBe('haiku_summary')
  })
})

describe('assignSourcePath — flag OFF', () => {
  it.each([
    'wire_service',
    'national',
    'specialty',
    'regional',
    'emerging',
    'unclassified',
    'totally_made_up',
    '',
  ])('tier=%s \u2192 full_debate when flag is off', (tier) => {
    expect(assignSourcePath(tier, false)).toBe('full_debate')
  })
})

// ---------------------------------------------------------------------------
// FLAG 1 — assignSourcesByTier() — array-in, classified array out + assertion
// ---------------------------------------------------------------------------

describe('assignSourcesByTier', () => {
  // Synthetic 6-source mixed-tier set (reused below in the integration test).
  const SIX_MIXED = [
    { url: 'https://apnews.com/x', outlet: 'AP', tier: 'wire_service' },
    { url: 'https://nytimes.com/x', outlet: 'NYT', tier: 'national' },
    { url: 'https://lloyds-list.com/x', outlet: "Lloyd's List", tier: 'specialty' },
    { url: 'https://sf-chronicle.com/x', outlet: 'SF Chronicle', tier: 'regional' },
    { url: 'https://newpaper.io/x', outlet: 'NewPaper', tier: 'emerging' },
    { url: 'https://random-blog.example/x', outlet: 'RandomBlog', tier: 'unclassified' },
  ]

  it('classifies a 6-source mixed-tier set correctly when flag is on', () => {
    const flags = resolveFlags({ env: {} }) // flag 1 on by default
    const result = assignSourcesByTier(SIX_MIXED, flags)
    expect(result).toHaveLength(6)
    expect(result.map((r) => r.assignedPath)).toEqual([
      'full_debate',
      'full_debate',
      'full_debate',
      'two_model_debate',
      'haiku_summary',
      'haiku_summary',
    ])
    // Every classified source preserves its original fields
    expect(result[0].url).toBe('https://apnews.com/x')
    expect(result[3].outlet).toBe('SF Chronicle')
  })

  it('routes every source to full_debate when flag 1 is off', () => {
    const flags = resolveFlags({ env: { PIPELINE_TIERED_SOURCE_PROCESSING: '0' } })
    const result = assignSourcesByTier(SIX_MIXED, flags)
    expect(result).toHaveLength(6)
    expect(result.every((r) => r.assignedPath === 'full_debate')).toBe(true)
  })

  it('routes every source to full_debate when force-full-quality is active', () => {
    const flags = resolveFlags({ forceFullQuality: true, env: {} })
    const result = assignSourcesByTier(SIX_MIXED, flags)
    expect(result.every((r) => r.assignedPath === 'full_debate')).toBe(true)
  })

  it('handles empty input', () => {
    const flags = resolveFlags({ env: {} })
    expect(assignSourcesByTier([], flags)).toEqual([])
  })

  it('non-negotiable assertion fires if classification logic ever produces a tier-1 \u2192 non-full assignment', () => {
    // Direct injection-style test: bypass assignSourcesByTier and call the
    // assertion against a manually-misassigned tier-1 source. This guards
    // against a future refactor that accidentally demotes a wire/national.
    expect(() =>
      assertTier1FullDebate(
        { tier: 'wire_service', assignedPath: 'haiku_summary' },
        'tiered_source_processing',
      ),
    ).toThrow(/NON-NEGOTIABLE VIOLATION/)
  })

  it('aggregate counts by path are correct for downstream telemetry', () => {
    const flags = resolveFlags({ env: {} })
    const result = assignSourcesByTier(SIX_MIXED, flags)
    const counts = result.reduce<Record<DebatePath, number>>(
      (acc, r) => {
        acc[r.assignedPath] = (acc[r.assignedPath] ?? 0) + 1
        return acc
      },
      { full_debate: 0, two_model_debate: 0, haiku_summary: 0 },
    )
    expect(counts).toEqual({
      full_debate: 3,
      two_model_debate: 1,
      haiku_summary: 2,
    })
  })

  it('preserves source ordering through classification', () => {
    const flags = resolveFlags({ env: {} })
    const ordered = [
      { url: 'a', outlet: 'a', tier: 'unclassified' },
      { url: 'b', outlet: 'b', tier: 'wire_service' },
      { url: 'c', outlet: 'c', tier: 'regional' },
    ]
    const result = assignSourcesByTier(ordered, flags)
    expect(result.map((r) => r.url)).toEqual(['a', 'b', 'c'])
  })

  it('throws if a tier-1 source somehow gets a non-full path (manual injection guard)', () => {
    // Simulate a rogue caller that hand-builds a mis-classified tier-1 source
    // and tries to push it through the assertion. This is what protects the
    // pipeline from a buggy future flag refactor silently demoting tier-1.
    expect(() =>
      assertTier1FullDebate(
        { tier: 'national', assignedPath: 'two_model_debate' },
        'tiered_source_processing',
      ),
    ).toThrow(/national/)
  })
})

// ---------------------------------------------------------------------------
// FLAG 1 — lookupSourceTiers() — domain extraction + Outlet table batch lookup
// ---------------------------------------------------------------------------

describe('lookupSourceTiers', () => {
  it('extracts hostnames from URLs and returns a url \u2192 tier map', async () => {
    const fetcher: TierFetcher = async (domains) => {
      // Stub fetcher: simulate Outlet table containing only AP + NYT
      const map: Record<string, string> = {}
      for (const d of domains) {
        if (d === 'apnews.com') map[d] = 'wire_service'
        if (d === 'nytimes.com') map[d] = 'national'
      }
      return map
    }
    const result = await lookupSourceTiers(
      [
        { url: 'https://apnews.com/article-1' },
        { url: 'https://www.nytimes.com/article-2' },
        { url: 'https://obscure-blog.example/x' },
      ],
      fetcher,
    )
    expect(result['https://apnews.com/article-1']).toBe('wire_service')
    expect(result['https://www.nytimes.com/article-2']).toBe('national')
    expect(result['https://obscure-blog.example/x']).toBe('unclassified')
  })

  it('strips www. prefix when normalizing domains for lookup', async () => {
    const seen: string[] = []
    const fetcher: TierFetcher = async (domains) => {
      seen.push(...domains)
      return { 'apnews.com': 'wire_service' }
    }
    await lookupSourceTiers([{ url: 'https://www.apnews.com/x' }], fetcher)
    expect(seen).toEqual(['apnews.com'])
  })

  it('deduplicates domains before fetching (one DB hit per unique domain)', async () => {
    const seen: string[] = []
    const fetcher: TierFetcher = async (domains) => {
      seen.push(...domains)
      return Object.fromEntries(domains.map((d) => [d, 'national']))
    }
    await lookupSourceTiers(
      [
        { url: 'https://nytimes.com/a' },
        { url: 'https://nytimes.com/b' },
        { url: 'https://nytimes.com/c' },
        { url: 'https://www.nytimes.com/d' },
      ],
      fetcher,
    )
    expect(seen).toEqual(['nytimes.com'])
  })

  it('handles malformed URLs by classifying them as unclassified without throwing', async () => {
    const fetcher: TierFetcher = async () => ({})
    const result = await lookupSourceTiers(
      [
        { url: 'not-a-real-url' },
        { url: '' },
        { url: 'https://valid.com/x' },
      ],
      fetcher,
    )
    expect(result['not-a-real-url']).toBe('unclassified')
    expect(result['']).toBe('unclassified')
    expect(result['https://valid.com/x']).toBe('unclassified')
  })

  it('handles empty source list (no fetcher invocation)', async () => {
    let invoked = false
    const fetcher: TierFetcher = async () => {
      invoked = true
      return {}
    }
    const result = await lookupSourceTiers([], fetcher)
    expect(result).toEqual({})
    expect(invoked).toBe(false)
  })

  it('domains absent from the Outlet table default to unclassified', async () => {
    const fetcher: TierFetcher = async () => ({}) // empty registry
    const result = await lookupSourceTiers(
      [
        { url: 'https://wire-service-of-the-future.com/x' },
        { url: 'https://national-paper.com/x' },
      ],
      fetcher,
    )
    expect(result['https://wire-service-of-the-future.com/x']).toBe('unclassified')
    expect(result['https://national-paper.com/x']).toBe('unclassified')
  })

  it('passes through complex URLs (paths, query, hash, port) without losing the host', async () => {
    let captured: string[] = []
    const fetcher: TierFetcher = async (domains) => {
      captured = domains
      return { 'example.com': 'national' }
    }
    const result = await lookupSourceTiers(
      [{ url: 'https://example.com:8443/path/to/article?id=123#section' }],
      fetcher,
    )
    expect(captured).toEqual(['example.com'])
    expect(result['https://example.com:8443/path/to/article?id=123#section']).toBe('national')
  })
})
