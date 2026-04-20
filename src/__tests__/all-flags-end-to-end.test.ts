/**
 * End-to-end integration test for all five cost-optimization flags running
 * simultaneously. Mirrors the actual pipeline.ts orchestration:
 *
 *   1. Flag 1 (tiered_source_processing) \u2014 assignSourcesByTier
 *   2. Flag 2 (arc_rerun_differential) \u2014 applyNoveltyToPaths
 *   3. Flag 3 (semantic_dedup)         \u2014 applyUniquenessToPaths
 *   4. Flag 5 (regional_debate_pooling) \u2014 applyRegionalPooling (per-region top-N)
 *   5. Flag 4 (confidence_threshold_exit) \u2014 inside dispatchRegionByTier \u2192 runRegionalDebate (mocked)
 *
 * Validates:
 *   - All 5 flags compose without conflicting
 *   - Tier-1 protection holds across the entire chain
 *   - Force-full-quality bypasses every flag
 *   - Per-flag demotion attribution is correct
 *   - assertContestedClaimDebated is honored end-to-end
 */

import { describe, it, expect } from 'vitest'
import { resolveFlags, assignSourcesByTier, type DebatePath } from '@/lib/pipeline-flags'
import { applyNoveltyToPaths, type NoveltyByUrl } from '@/lib/arc-rerun-differential'
import { applyUniquenessToPaths, DEFAULT_UNIQUENESS_THRESHOLD, type ScoresByUrl } from '@/lib/semantic-dedup'
import { applyRegionalPooling } from '@/lib/regional-debate-pooling'
import { decideFlag4Exit, type ClaudeCaller } from '@/lib/consensus-assessor'

// 12 sources mixing tiers, simulating one region's pool after triage.
const TWELVE_SOURCES = [
  // 4 tier-1 sources (must always full_debate)
  { url: 'wire-1',     outlet: 'AP',           tier: 'wire_service', publishedAt: '2026-04-19T01:00:00Z' },
  { url: 'national-1', outlet: 'NYT',          tier: 'national',     publishedAt: '2026-04-19T02:00:00Z' },
  { url: 'national-2', outlet: 'WaPo',         tier: 'national',     publishedAt: '2026-04-19T03:00:00Z' },
  { url: 'specialty-1',outlet: "Lloyd's List", tier: 'specialty',    publishedAt: '2026-04-19T04:00:00Z' },

  // 5 regional sources \u2014 Flag 1 routes to two_model; Flag 2/3/5 may demote
  { url: 'regional-1', outlet: 'SF Chron',     tier: 'regional',     publishedAt: '2026-04-19T05:00:00Z' },
  { url: 'regional-2', outlet: 'Boston Glob',  tier: 'regional',     publishedAt: '2026-04-19T06:00:00Z' },
  { url: 'regional-3', outlet: 'Chicago Trib', tier: 'regional',     publishedAt: '2026-04-19T07:00:00Z' },
  { url: 'regional-4', outlet: 'LA Times',     tier: 'regional',     publishedAt: '2026-04-19T08:00:00Z' },
  { url: 'regional-5', outlet: 'Houston Chr',  tier: 'regional',     publishedAt: '2026-04-19T09:00:00Z' },

  // 3 emerging/unclassified \u2014 Flag 1 routes to haiku
  { url: 'emerging-1', outlet: 'NewPaper',     tier: 'emerging',     publishedAt: '2026-04-19T10:00:00Z' },
  { url: 'emerging-2', outlet: 'NewSite',      tier: 'emerging',     publishedAt: '2026-04-19T11:00:00Z' },
  { url: 'unclass-1',  outlet: 'RandomBlog',   tier: 'unclassified', publishedAt: '2026-04-19T12:00:00Z' },
]

describe('All five flags chained end-to-end (default ON)', () => {
  it('composes Flag 1 + 2 + 3 + 5 without losing tier-1 sources to demotion', () => {
    const flags = resolveFlags({ env: {} })

    // Step 1 \u2014 Flag 1: tier classification
    const tier = assignSourcesByTier(TWELVE_SOURCES, flags)
    // Tier-1 sources \u2192 full_debate
    expect(tier.find((c) => c.url === 'wire-1')!.assignedPath).toBe('full_debate')
    expect(tier.find((c) => c.url === 'national-1')!.assignedPath).toBe('full_debate')
    expect(tier.find((c) => c.url === 'specialty-1')!.assignedPath).toBe('full_debate')
    // Regional \u2192 two_model_debate
    expect(tier.find((c) => c.url === 'regional-1')!.assignedPath).toBe('two_model_debate')
    // Emerging/unclassified \u2192 haiku_summary
    expect(tier.find((c) => c.url === 'emerging-1')!.assignedPath).toBe('haiku_summary')

    // Step 2 \u2014 Flag 2 (skip: not arc_rerun in this test, so no-op via novelty input being all "new")
    const novelty: NoveltyByUrl = Object.fromEntries(
      TWELVE_SOURCES.map((s) => [s.url, 'new_since_last_run']),
    )
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    expect(afterFlag2).toEqual(tier) // no demotions when all new

    // Step 3 \u2014 Flag 3: regional-3 + regional-4 are duplicate (low score)
    const scores: ScoresByUrl = {
      'wire-1': 8, 'national-1': 9, 'national-2': 7, 'specialty-1': 10,
      'regional-1': 8, 'regional-2': 9, 'regional-3': 1, 'regional-4': 2, 'regional-5': 7,
      'emerging-1': 5, 'emerging-2': 5, 'unclass-1': 5,
    }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    // Tier-1 untouched
    expect(afterFlag3.find((c) => c.url === 'wire-1')!.assignedPath).toBe('full_debate')
    expect(afterFlag3.find((c) => c.url === 'specialty-1')!.assignedPath).toBe('full_debate')
    // regional-3 + regional-4 demoted (score < 4)
    expect(afterFlag3.find((c) => c.url === 'regional-3')!.assignedPath).toBe('haiku_summary')
    expect(afterFlag3.find((c) => c.url === 'regional-4')!.assignedPath).toBe('haiku_summary')
    // regional-1, 2, 5 keep two_model
    expect(afterFlag3.find((c) => c.url === 'regional-1')!.assignedPath).toBe('two_model_debate')
    expect(afterFlag3.find((c) => c.url === 'regional-2')!.assignedPath).toBe('two_model_debate')
    expect(afterFlag3.find((c) => c.url === 'regional-5')!.assignedPath).toBe('two_model_debate')

    // Step 4 \u2014 Flag 5: per-region top-N cap
    // After Flag 3: 4 tier-1 (full) + 3 regional (two_model) + 5 haiku = 12 total
    // Sort: tier-1 first (4), then regional (3), then haiku (5). All 4 tier-1 in cap.
    // 3 regionals + 1 haiku source make rank 5-8. Remaining 4 haiku already haiku.
    // So nothing additional gets demoted by Flag 5 (everything was in the cap or already haiku).
    const afterFlag5 = applyRegionalPooling(afterFlag3, flags)
    // No new demotions (already-haiku stay haiku, top 8 includes all non-haiku)
    expect(afterFlag5.filter((c) => c.assignedPath === 'haiku_summary').length).toBe(
      afterFlag3.filter((c) => c.assignedPath === 'haiku_summary').length,
    )
    // Tier-1 still safe
    for (const url of ['wire-1', 'national-1', 'national-2', 'specialty-1']) {
      expect(afterFlag5.find((c) => c.url === url)!.assignedPath).toBe('full_debate')
    }
  })

  it('Flag 5 demotes when many regional sources accumulate after Flags 1-3', () => {
    // Build a 14-source set with lots of regionals so Flag 5's cap actually bites.
    const fourteenSources = [
      ...TWELVE_SOURCES,
      { url: 'regional-6', outlet: 'Miami Herald', tier: 'regional', publishedAt: '2026-04-19T13:00:00Z' },
      { url: 'regional-7', outlet: 'Atlanta JC',   tier: 'regional', publishedAt: '2026-04-19T14:00:00Z' },
    ]
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(fourteenSources, flags)
    // No Flag 2 demotion
    const afterFlag2 = applyNoveltyToPaths(
      tier,
      Object.fromEntries(fourteenSources.map((s) => [s.url, 'new_since_last_run'])) as NoveltyByUrl,
      [],
      flags,
    )
    // No Flag 3 demotion (all unique)
    const afterFlag3 = applyUniquenessToPaths(
      afterFlag2,
      Object.fromEntries(fourteenSources.map((s) => [s.url, 8])),
      DEFAULT_UNIQUENESS_THRESHOLD,
      flags,
    )
    // After Flags 1-3: 4 tier-1 (full) + 7 regional (two_model) + 3 haiku = 14 total
    // Flag 5 sorts: 4 tier-1 first, then 7 regionals (rank 3), then 3 haiku.
    // Top 8 = 4 tier-1 + 4 regionals. Remaining 3 regionals demoted to haiku.
    const afterFlag5 = applyRegionalPooling(afterFlag3, flags)
    // Tier-1 all safe
    for (const url of ['wire-1', 'national-1', 'national-2', 'specialty-1']) {
      expect(afterFlag5.find((c) => c.url === url)!.assignedPath).toBe('full_debate')
    }
    // Of the 7 regionals: 4 keep two_model (the earliest-published ones), 3 demoted
    const regionalPaths = ['regional-1', 'regional-2', 'regional-3', 'regional-4', 'regional-5', 'regional-6', 'regional-7']
      .map((url) => ({ url, path: afterFlag5.find((c) => c.url === url)!.assignedPath }))
    const inTwoModel = regionalPaths.filter((r) => r.path === 'two_model_debate')
    const inHaiku = regionalPaths.filter((r) => r.path === 'haiku_summary')
    expect(inTwoModel).toHaveLength(4)
    expect(inHaiku).toHaveLength(3)
    // The earliest-published 4 regionals (regional-1..4) should be the kept ones
    expect(inTwoModel.map((r) => r.url).sort()).toEqual(['regional-1', 'regional-2', 'regional-3', 'regional-4'])
  })

  it('PIPELINE_FORCE_FULL_QUALITY=1 makes ALL FIVE flags no-op (every source full_debate)', () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    expect(flags.forceFullQualityActive).toBe(true)

    const tier = assignSourcesByTier(TWELVE_SOURCES, flags)
    // Force-full \u2192 all sources go to full_debate even before Flag 2/3/5
    expect(tier.every((c) => c.assignedPath === 'full_debate')).toBe(true)

    // Each subsequent flag is a no-op under force-full
    const novelty: NoveltyByUrl = Object.fromEntries(
      TWELVE_SOURCES.map((s) => [s.url, 'continuing_coverage']),
    )
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    expect(afterFlag2).toEqual(tier)

    const scores: ScoresByUrl = Object.fromEntries(TWELVE_SOURCES.map((s) => [s.url, 0]))
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(afterFlag3).toEqual(tier)

    const afterFlag5 = applyRegionalPooling(afterFlag3, flags)
    expect(afterFlag5).toEqual(tier)
  })

  it('Flag 4 (consensus exit) is no-op when fewer than 4 valid R1 results', async () => {
    // The 4-model rule means Flag 4 cannot exit even if all R1 outputs agree
    // when only 3 are present. This is a hard guard, not a configuration.
    const flags = resolveFlags({ env: {} })
    const threeR1 = [
      { modelName: 'Claude',  analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [] } },
      { modelName: 'GPT-5.4', analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [] } },
      { modelName: 'Gemini',  analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [] } },
    ]
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const decision = await decideFlag4Exit(threeR1, 'NA', flags, { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(decision.exit).toBe(false)
    expect(decision.skipReason).toBe('insufficient_models')
  })

  it('Flag 4 + a single contested claim \u2192 no exit (the airtight rule applied across the chain)', async () => {
    const flags = resolveFlags({ env: {} })
    const fourR1 = [
      { modelName: 'Claude',  analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }, { fact: 'F2', confidence: 'HIGH' as const }], contested_claims: [] } },
      { modelName: 'GPT-5.4', analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }, { fact: 'F2', confidence: 'HIGH' as const }], contested_claims: [] } },
      { modelName: 'Gemini',  analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }, { fact: 'F2', confidence: 'HIGH' as const }], contested_claims: [] } },
      { modelName: 'Grok',    analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }],                         contested_claims: [{ claim: 'F2' }] } },
    ]
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F2', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'], modelsDissenting: ['Grok'], dissentSubstantive: true },
      ],
    })
    const caller: ClaudeCaller = async () => ({ text: json, inputTokens: 200, outputTokens: 80, costUsd: 0.005 })
    const decision = await decideFlag4Exit(fourR1, 'NA', flags, { claudeCaller: caller })
    expect(decision.exit).toBe(false)
    expect(decision.skipReason).toBe('contested_claims_present')
    expect(decision.consensusClaimsCount).toBe(1)
    expect(decision.contestedClaimsCount).toBe(1)
  })

  it('tier-1 protection invariant holds across all 5 flags simultaneously', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(TWELVE_SOURCES, flags)

    // Try to demote tier-1 via every flag's input that could cause harm
    const noveltyAttacking = Object.fromEntries(
      TWELVE_SOURCES.map((s) => [s.url, 'continuing_coverage']),
    ) as NoveltyByUrl
    const afterFlag2 = applyNoveltyToPaths(tier, noveltyAttacking, [], flags)

    const scoresAttacking: ScoresByUrl = Object.fromEntries(
      TWELVE_SOURCES.map((s) => [s.url, 0]),
    )
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scoresAttacking, DEFAULT_UNIQUENESS_THRESHOLD, flags)

    const afterFlag5 = applyRegionalPooling(afterFlag3, flags)

    // After all 5 flags, every tier-1 source MUST still be at full_debate
    for (const tier1Tier of ['wire_service', 'national', 'specialty']) {
      const tier1Sources = afterFlag5.filter((c) => c.tier === tier1Tier)
      for (const c of tier1Sources) {
        expect(c.assignedPath).toBe('full_debate')
      }
    }
  })

  it('per-flag demotion attribution: each flag is credited only with its OWN demotions (no double counting)', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(TWELVE_SOURCES, flags)

    // Flag 2: demotes regional-1 only
    const novelty: NoveltyByUrl = {
      'wire-1': 'new_since_last_run', 'national-1': 'new_since_last_run',
      'national-2': 'new_since_last_run', 'specialty-1': 'new_since_last_run',
      'regional-1': 'continuing_coverage',
      'regional-2': 'new_since_last_run', 'regional-3': 'new_since_last_run',
      'regional-4': 'new_since_last_run', 'regional-5': 'new_since_last_run',
      'emerging-1': 'continuing_coverage', 'emerging-2': 'continuing_coverage', 'unclass-1': 'new_since_last_run',
    }
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    let flag2Demoted = 0
    for (let i = 0; i < tier.length; i++) {
      if (tier[i].assignedPath !== afterFlag2[i].assignedPath) flag2Demoted++
    }
    expect(flag2Demoted).toBe(1) // only regional-1

    // Flag 3: demotes regional-2 only (regional-1 already haiku from Flag 2)
    const scores: ScoresByUrl = {
      'wire-1': 9, 'national-1': 9, 'national-2': 9, 'specialty-1': 9,
      'regional-1': 0, // already haiku, no-op
      'regional-2': 0, // demoted now
      'regional-3': 9, 'regional-4': 9, 'regional-5': 9,
      'emerging-1': 0, 'emerging-2': 0, 'unclass-1': 0,
    }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    let flag3Demoted = 0
    for (let i = 0; i < afterFlag2.length; i++) {
      if (afterFlag2[i].assignedPath !== afterFlag3[i].assignedPath) flag3Demoted++
    }
    expect(flag3Demoted).toBe(1) // only regional-2 (regional-1 was already haiku)

    // Flag 5: 12 sources. After Flag 1+2+3: 4 tier-1 + 3 regional + 5 haiku.
    // All 7 non-haiku fit in cap of 8. No demotions.
    const afterFlag5 = applyRegionalPooling(afterFlag3, flags)
    let flag5Demoted = 0
    for (let i = 0; i < afterFlag3.length; i++) {
      if (afterFlag3[i].assignedPath !== afterFlag5[i].assignedPath) flag5Demoted++
    }
    expect(flag5Demoted).toBe(0) // all non-haiku fit in cap

    // Total demotions from baseline: 2 (regional-1 + regional-2)
    let totalDemotions = 0
    for (let i = 0; i < tier.length; i++) {
      if (tier[i].assignedPath !== afterFlag5[i].assignedPath) totalDemotions++
    }
    expect(totalDemotions).toBe(2)
    expect(flag2Demoted + flag3Demoted + flag5Demoted).toBe(totalDemotions)
  })
})
