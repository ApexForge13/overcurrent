/**
 * Integration test for Flag 1 (tiered_source_processing).
 *
 * Feeds a synthetic 6-source mixed-tier set through dispatchRegionByTier
 * end-to-end with mocked debate + haiku stages. Verifies:
 *   - All three sub-paths receive the right sources
 *   - Two-model call uses Claude+Grok subset only
 *   - Merge produces the expected union of claims, summaries, framings
 *   - Telemetry counts + costs are correct
 *   - Flag-off short-circuits everything to full_debate
 *   - Force-full short-circuits everything to full_debate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchRegionByTier, TWO_MODEL_PROVIDERS } from '@/lib/tier-dispatch'
import { resolveFlags, type DebatePath } from '@/lib/pipeline-flags'

// Track all calls so we can assert on them
const debateCalls: Array<{
  region: string
  sourceCount: number
  analystSubset: ReadonlyArray<string> | undefined
  flagsForwarded: boolean
}> = []
const haikuCalls: Array<{ region: string; sourceCount: number }> = []

vi.mock('@/lib/debate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/debate')>()
  return {
    ...actual,
    runRegionalDebate: vi.fn(async (
      region: string,
      sources: Array<{ url: string }>,
      _query: string,
      _storyId: string | undefined,
      _onProgress: ((m: string) => void) | undefined,
      analystSubset?: ReadonlyArray<string>,
      flagsArg?: { confidence_threshold_exit?: boolean },
    ) => {
      debateCalls.push({ region, sourceCount: sources.length, analystSubset, flagsForwarded: flagsArg !== undefined })
      const variant = analystSubset && analystSubset.length > 0 ? 'two_model' : 'full'
      return {
        moderatorOutput: {
          region,
          models_participating: [],
          consensus_findings: [{
            fact: `${variant}-debate consensus from ${sources.length} sources`,
            confidence: 'HIGH' as const,
            models_agreeing: [],
            evidence_quality: 'multi-source',
            original_source: sources.map((s) => s.url).join(','),
          }],
          resolved_disputes: [],
          unresolved_disputes: [],
          caught_errors: [],
          unique_insights: [],
          dominant_framing: `${variant} framing for ${region}`,
          source_quality: 'good',
          omissions: [],
          debate_quality_note: '',
        },
        debateRounds: [
          { region, round: 1, modelName: 'Claude', provider: 'anthropic', content: {}, inputTokens: 100, outputTokens: 50, costUsd: variant === 'full' ? 1.20 : 0.60 },
        ],
        totalCost: variant === 'full' ? 1.20 : 0.60,
        modelsUsed: variant === 'full' ? ['Claude', 'GPT', 'Gemini', 'Grok'] : ['Claude', 'Grok'],
        flag4: {
          consensusExited: false,
          skipReason: 'flag_off',
          consensusClaimsCount: 0,
          contestedClaimsCount: 0,
          assessorCostUsd: 0,
        },
      }
    }),
  }
})

vi.mock('@/lib/source-haiku-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/source-haiku-summary')>()
  return {
    ...actual,
    summarizeSourcesViaHaiku: vi.fn(async (region: string, sources: ReadonlyArray<{ url: string; outlet: string }>) => {
      haikuCalls.push({ region, sourceCount: sources.length })
      return {
        region,
        claims: [{
          claim: `haiku-stub claim from ${sources.length} sources`,
          confidence: 'LOW' as const,
          supportedBy: sources.map((s) => s.outlet),
          contradictedBy: [],
        }],
        discrepancies: [],
        framingAnalysis: { framing: `haiku framing for ${region}`, notableAngles: ['emerging'] },
        omissions: [],
        sourceSummaries: sources.map((s) => ({ url: s.url, summary: `${s.outlet} (haiku)` })),
        costUsd: 0.005 * sources.length,
      }
    }),
  }
})

beforeEach(() => {
  debateCalls.length = 0
  haikuCalls.length = 0
})

const SIX_MIXED_NA_SOURCES = [
  { url: 'https://apnews.com/x',          outlet: 'AP',           title: 'Wire',     tier: 'wire_service' },
  { url: 'https://nytimes.com/x',         outlet: 'NYT',          title: 'National', tier: 'national' },
  { url: 'https://lloyds-list.com/x',     outlet: "Lloyd's List", title: 'Spec',     tier: 'specialty' },
  { url: 'https://sf-chronicle.com/x',    outlet: 'SF Chronicle', title: 'Regional', tier: 'regional' },
  { url: 'https://newpaper.io/x',         outlet: 'NewPaper',     title: 'Emerg',    tier: 'emerging' },
  { url: 'https://random-blog.example/x', outlet: 'RandomBlog',   title: 'Unclass',  tier: 'unclassified' },
]

describe('Flag 1 integration — 6-source mixed-tier set', () => {
  it('routes 3 sources to full debate, 1 to two-model debate, 2 to haiku summary', async () => {
    const flags = resolveFlags({ env: {} }) // all flags on
    const result = await dispatchRegionByTier('North America', SIX_MIXED_NA_SOURCES, 'q', flags)

    // Two debate calls (full + two-model) and one haiku call
    expect(debateCalls).toHaveLength(2)
    expect(haikuCalls).toHaveLength(1)

    // Full-debate call: 3 sources (AP, NYT, Lloyd's List), no analystSubset
    const fullCall = debateCalls.find((c) => !c.analystSubset || c.analystSubset.length === 0)
    expect(fullCall).toBeDefined()
    expect(fullCall!.sourceCount).toBe(3)

    // Two-model call: 1 source (SF Chronicle), analystSubset=[anthropic, xai]
    const twoModelCall = debateCalls.find((c) => c.analystSubset && c.analystSubset.length > 0)
    expect(twoModelCall).toBeDefined()
    expect(twoModelCall!.sourceCount).toBe(1)
    expect(twoModelCall!.analystSubset).toEqual(TWO_MODEL_PROVIDERS)

    // Haiku call: 2 sources (NewPaper, RandomBlog)
    expect(haikuCalls[0].sourceCount).toBe(2)
    expect(haikuCalls[0].region).toBe('North America')

    // Telemetry totals
    expect(result.telemetry).toEqual({
      region: 'North America',
      fullDebateCount: 3,
      fullDebateCostUsd: 1.20,
      twoModelCount: 1,
      twoModelCostUsd: 0.60,
      haikuCount: 2,
      haikuCostUsd: 0.01, // 2 sources * $0.005
      flag4: {
        consensusExited: false,
        skipReason: 'flag_off',
        consensusClaimsCount: 0,
        contestedClaimsCount: 0,
        assessorCostUsd: 0,
      },
      flag5DemotedCount: 0, // 6 sources < cap of 8 \u2192 no demotions
    })
  })

  it('merges all 3 sub-analyses into one RegionalAnalysis (claims unioned)', async () => {
    const flags = resolveFlags({ env: {} })
    const result = await dispatchRegionByTier('North America', SIX_MIXED_NA_SOURCES, 'q', flags)
    // 1 claim from full + 1 from two-model + 1 from haiku = 3 claims merged
    expect(result.analysis.claims).toHaveLength(3)
    expect(result.analysis.claims[0].claim).toMatch(/full-debate consensus/)
    expect(result.analysis.claims[1].claim).toMatch(/two_model-debate consensus/)
    expect(result.analysis.claims[2].claim).toMatch(/haiku-stub claim/)
  })

  it('framing is taken from the highest-tier sub-analysis (full)', async () => {
    const flags = resolveFlags({ env: {} })
    const result = await dispatchRegionByTier('North America', SIX_MIXED_NA_SOURCES, 'q', flags)
    expect(result.analysis.framingAnalysis.framing).toMatch(/full framing/)
  })

  it('cost sums all three sub-paths', async () => {
    const flags = resolveFlags({ env: {} })
    const result = await dispatchRegionByTier('North America', SIX_MIXED_NA_SOURCES, 'q', flags)
    // 1.20 (full) + 0.60 (two-model) + 0.01 (haiku) = 1.81
    expect(result.analysis.costUsd).toBeCloseTo(1.81, 2)
  })

  it('flag-off routes every source to full debate (one debate call, no haiku)', async () => {
    const flags = resolveFlags({ env: { PIPELINE_TIERED_SOURCE_PROCESSING: '0' } })
    const result = await dispatchRegionByTier('North America', SIX_MIXED_NA_SOURCES, 'q', flags)
    expect(debateCalls).toHaveLength(1)
    expect(debateCalls[0].sourceCount).toBe(6)
    expect(debateCalls[0].analystSubset).toBeUndefined()
    expect(haikuCalls).toHaveLength(0)
    expect(result.telemetry.fullDebateCount).toBe(6)
    expect(result.telemetry.twoModelCount).toBe(0)
    expect(result.telemetry.haikuCount).toBe(0)
  })

  it('PIPELINE_FORCE_FULL_QUALITY=1 routes every source to full debate (overrides flag)', async () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    const result = await dispatchRegionByTier('North America', SIX_MIXED_NA_SOURCES, 'q', flags)
    expect(debateCalls).toHaveLength(1)
    expect(debateCalls[0].sourceCount).toBe(6)
    expect(haikuCalls).toHaveLength(0)
    expect(flags.forceFullQualityActive).toBe(true)
    expect(result.telemetry.fullDebateCount).toBe(6)
  })

  it('empty source list returns stub without invoking debate or haiku', async () => {
    const flags = resolveFlags({ env: {} })
    const result = await dispatchRegionByTier('North America', [], 'q', flags)
    expect(debateCalls).toHaveLength(0)
    expect(haikuCalls).toHaveLength(0)
    expect(result.analysis.claims).toEqual([])
    expect(result.analysis.costUsd).toBe(0)
    expect(result.telemetry.fullDebateCount).toBe(0)
  })

  it('all-tier-1-only set: only full debate runs (no two-model, no haiku)', async () => {
    const allTier1 = [
      { url: 'a', outlet: 'AP', title: 't', tier: 'wire_service' },
      { url: 'b', outlet: 'NYT', title: 't', tier: 'national' },
    ]
    const flags = resolveFlags({ env: {} })
    await dispatchRegionByTier('NA', allTier1, 'q', flags)
    expect(debateCalls).toHaveLength(1)
    expect(debateCalls[0].sourceCount).toBe(2)
    expect(debateCalls[0].analystSubset).toBeUndefined()
    expect(haikuCalls).toHaveLength(0)
  })

  it('all-emerging set: only haiku runs (no debate)', async () => {
    const allEmerging = [
      { url: 'a', outlet: 'NewPaper', title: 't', tier: 'emerging' },
      { url: 'b', outlet: 'RandomBlog', title: 't', tier: 'unclassified' },
    ]
    const flags = resolveFlags({ env: {} })
    await dispatchRegionByTier('NA', allEmerging, 'q', flags)
    expect(debateCalls).toHaveLength(0)
    expect(haikuCalls).toHaveLength(1)
    expect(haikuCalls[0].sourceCount).toBe(2)
  })

  it('Flag 4 plumbing: flags arg forwarded to runRegionalDebate so consensus check can run', async () => {
    const flags = resolveFlags({ env: {} })
    await dispatchRegionByTier('NA', SIX_MIXED_NA_SOURCES, 'q', flags)
    // Both the full and the two-model debate calls should have received flags
    const fullCall = debateCalls.find((c) => !c.analystSubset || c.analystSubset.length === 0)
    const twoModelCall = debateCalls.find((c) => c.analystSubset && c.analystSubset.length > 0)
    expect(fullCall?.flagsForwarded).toBe(true)
    expect(twoModelCall?.flagsForwarded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Flag 2 hook: pathOverrides option lets the caller (pipeline.ts) inject
// novelty-based path decisions on top of tier-based classification.
// ---------------------------------------------------------------------------

describe('dispatchRegionByTier \u2014 pathOverrides', () => {
  it('respects pathOverrides: a regional source forced to haiku is reassigned', async () => {
    const flags = resolveFlags({ env: {} })
    const overrides = new Map<string, DebatePath>([
      ['https://sf-chronicle.com/x', 'haiku_summary'], // demote regional \u2192 haiku
    ])
    const result = await dispatchRegionByTier(
      'North America',
      SIX_MIXED_NA_SOURCES,
      'q',
      flags,
      { pathOverrides: overrides },
    )
    // Original split was 3 full / 1 two-model / 2 haiku.
    // After override: 3 full / 0 two-model / 3 haiku.
    expect(result.telemetry.fullDebateCount).toBe(3)
    expect(result.telemetry.twoModelCount).toBe(0)
    expect(result.telemetry.haikuCount).toBe(3)
    // Two-model sub-debate should NOT have been called
    expect(debateCalls.find((c) => c.analystSubset && c.analystSubset.length > 0)).toBeUndefined()
  })

  it('pathOverrides cannot demote tier-1 (assertion fires)', async () => {
    const flags = resolveFlags({ env: {} })
    const overrides = new Map<string, DebatePath>([
      ['https://apnews.com/x', 'haiku_summary'], // wire_service \u2192 haiku attempted
    ])
    await expect(
      dispatchRegionByTier('NA', SIX_MIXED_NA_SOURCES, 'q', flags, { pathOverrides: overrides }),
    ).rejects.toThrow(/NON-NEGOTIABLE VIOLATION/)
  })

  it('pathOverrides for a URL not in the source list is silently ignored', async () => {
    const flags = resolveFlags({ env: {} })
    const overrides = new Map<string, DebatePath>([
      ['https://does-not-exist.com/x', 'haiku_summary'],
    ])
    const result = await dispatchRegionByTier(
      'NA',
      SIX_MIXED_NA_SOURCES,
      'q',
      flags,
      { pathOverrides: overrides },
    )
    // Original split unchanged
    expect(result.telemetry.fullDebateCount).toBe(3)
    expect(result.telemetry.twoModelCount).toBe(1)
    expect(result.telemetry.haikuCount).toBe(2)
  })

  it('pathOverrides=undefined is identical to no overrides (default behavior preserved)', async () => {
    const flags = resolveFlags({ env: {} })
    const result = await dispatchRegionByTier(
      'NA',
      SIX_MIXED_NA_SOURCES,
      'q',
      flags,
      { pathOverrides: undefined },
    )
    expect(result.telemetry.fullDebateCount).toBe(3)
    expect(result.telemetry.twoModelCount).toBe(1)
    expect(result.telemetry.haikuCount).toBe(2)
  })
})
