/**
 * Integration test for the Flag 2 + Flag 3 chain.
 *
 * Mirrors the actual pipeline.ts orchestration: assignSourcesByTier (Flag 1)
 * \u2192 applyNoveltyToPaths (Flag 2) \u2192 applyUniquenessToPaths (Flag 3) \u2192
 * pathOverrides Map fed to dispatchRegionByTier.
 *
 * Verifies the chain composes correctly:
 *   - Both flags can demote the same source (Flag 2 demotes first, Flag 3
 *     is a no-op on already-haiku sources).
 *   - Each flag demotes different sources independently.
 *   - Tier-1 protection holds across the entire chain.
 *   - Per-flag demotion counts are tracked correctly via diff.
 */

import { describe, it, expect } from 'vitest'
import {
  assignSourcesByTier,
  resolveFlags,
  type DebatePath,
} from '@/lib/pipeline-flags'
import { applyNoveltyToPaths, type NoveltyByUrl } from '@/lib/arc-rerun-differential'
import { applyUniquenessToPaths, DEFAULT_UNIQUENESS_THRESHOLD, type ScoresByUrl } from '@/lib/semantic-dedup'

const SIX_RAW = [
  { url: 'wire-1',     outlet: 'AP',           tier: 'wire_service' },
  { url: 'national-1', outlet: 'NYT',          tier: 'national' },
  { url: 'specialty-1',outlet: "Lloyd's List", tier: 'specialty' },
  { url: 'regional-1', outlet: 'SF Chronicle', tier: 'regional' },
  { url: 'regional-2', outlet: 'Boston Globe', tier: 'regional' },
  { url: 'emerging-1', outlet: 'NewPaper',     tier: 'emerging' },
]

describe('Flag 2 + Flag 3 chain orchestration', () => {
  it('Flag 1 only (Flags 2+3 off): tier-only classification', () => {
    const flags = resolveFlags({
      env: { PIPELINE_ARC_RERUN_DIFFERENTIAL: '0', PIPELINE_SEMANTIC_DEDUP: '0' },
    })
    const tier = assignSourcesByTier(SIX_RAW, flags)
    expect(tier.find((c) => c.url === 'regional-1')!.assignedPath).toBe('two_model_debate')
    expect(tier.find((c) => c.url === 'emerging-1')!.assignedPath).toBe('haiku_summary')
  })

  it('Flag 2 demotes a continuing regional source; Flag 3 does not double-demote it', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(SIX_RAW, flags)
    // Flag 2: regional-1 = continuing (not sampled), regional-2 = new
    const novelty: NoveltyByUrl = {
      'wire-1': 'new_since_last_run',
      'national-1': 'new_since_last_run',
      'specialty-1': 'new_since_last_run',
      'regional-1': 'continuing_coverage', // demoted to haiku
      'regional-2': 'new_since_last_run',
      'emerging-1': 'new_since_last_run',
    }
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    expect(afterFlag2.find((c) => c.url === 'regional-1')!.assignedPath).toBe('haiku_summary')
    expect(afterFlag2.find((c) => c.url === 'regional-2')!.assignedPath).toBe('two_model_debate')

    // Flag 3: regional-1 already haiku, regional-2 score 8 \u2192 keep
    const scores: ScoresByUrl = {
      'regional-1': 0,  // would demote, but already haiku
      'regional-2': 8,  // unique \u2192 keep
    }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    // No further demotions (regional-1 stayed haiku, regional-2 stayed two_model)
    expect(afterFlag3.find((c) => c.url === 'regional-1')!.assignedPath).toBe('haiku_summary')
    expect(afterFlag3.find((c) => c.url === 'regional-2')!.assignedPath).toBe('two_model_debate')
  })

  it('Flag 3 demotes a source Flag 2 left alone (different demotion targets)', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(SIX_RAW, flags)
    // Flag 2: all new \u2192 no demotions
    const novelty: NoveltyByUrl = {
      'wire-1': 'new_since_last_run',
      'national-1': 'new_since_last_run',
      'specialty-1': 'new_since_last_run',
      'regional-1': 'new_since_last_run',
      'regional-2': 'new_since_last_run',
      'emerging-1': 'new_since_last_run',
    }
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    expect(afterFlag2.find((c) => c.url === 'regional-1')!.assignedPath).toBe('two_model_debate')
    expect(afterFlag2.find((c) => c.url === 'regional-2')!.assignedPath).toBe('two_model_debate')

    // Flag 3: regional-1 score 1 \u2192 demote, regional-2 score 9 \u2192 keep
    const scores: ScoresByUrl = { 'regional-1': 1, 'regional-2': 9 }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(afterFlag3.find((c) => c.url === 'regional-1')!.assignedPath).toBe('haiku_summary')
    expect(afterFlag3.find((c) => c.url === 'regional-2')!.assignedPath).toBe('two_model_debate')
  })

  it('combined chain produces correct pathOverrides diff for dispatch', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(SIX_RAW, flags)
    const novelty: NoveltyByUrl = {
      'wire-1': 'continuing_coverage', // tier-1 protected
      'national-1': 'new_since_last_run',
      'specialty-1': 'continuing_coverage', // tier-1 protected
      'regional-1': 'continuing_coverage', // candidate for Flag 2 demotion
      'regional-2': 'new_since_last_run',
      'emerging-1': 'continuing_coverage', // already haiku
    }
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    const scores: ScoresByUrl = {
      'wire-1': 0, 'national-1': 0, 'specialty-1': 0, // would demote, but tier-1 protected
      'regional-1': 0, // already haiku from Flag 2
      'regional-2': 1, // Flag 3 demotes
      'emerging-1': 0, // already haiku
    }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)

    // Build pathOverrides: diff between tier-only and final
    const overrides = new Map<string, DebatePath>()
    for (let i = 0; i < tier.length; i++) {
      if (tier[i].assignedPath !== afterFlag3[i].assignedPath) {
        overrides.set(tier[i].url, afterFlag3[i].assignedPath)
      }
    }

    // Both regionals should be in the override map (both demoted to haiku)
    expect(overrides.get('regional-1')).toBe('haiku_summary')
    expect(overrides.get('regional-2')).toBe('haiku_summary')
    // Tier-1 sources NOT in overrides
    expect(overrides.has('wire-1')).toBe(false)
    expect(overrides.has('national-1')).toBe(false)
    expect(overrides.has('specialty-1')).toBe(false)
    // Already-haiku sources NOT in overrides (they didn't change)
    expect(overrides.has('emerging-1')).toBe(false)
    expect(overrides.size).toBe(2)
  })

  it('per-flag demotion counts tracked correctly via diff', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(SIX_RAW, flags)

    // Flag 2: demotes regional-1 only
    const novelty: NoveltyByUrl = {
      'wire-1': 'new_since_last_run',
      'national-1': 'new_since_last_run',
      'specialty-1': 'new_since_last_run',
      'regional-1': 'continuing_coverage',
      'regional-2': 'new_since_last_run',
      'emerging-1': 'new_since_last_run',
    }
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    let flag2Demoted = 0
    for (let i = 0; i < tier.length; i++) {
      if (tier[i].assignedPath !== afterFlag2[i].assignedPath) flag2Demoted++
    }
    expect(flag2Demoted).toBe(1) // regional-1

    // Flag 3: demotes regional-2 only (regional-1 already haiku)
    const scores: ScoresByUrl = { 'regional-1': 0, 'regional-2': 0 }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    let flag3Demoted = 0
    for (let i = 0; i < afterFlag2.length; i++) {
      if (afterFlag2[i].assignedPath !== afterFlag3[i].assignedPath) flag3Demoted++
    }
    expect(flag3Demoted).toBe(1) // regional-2 (regional-1 didn't change because it was already haiku)
  })

  it('PIPELINE_FORCE_FULL_QUALITY=1 makes both flags no-op (no demotions)', () => {
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    const tier = assignSourcesByTier(SIX_RAW, flags)
    // Under force-full, even tier classification routes everything to full_debate
    expect(tier.every((c) => c.assignedPath === 'full_debate')).toBe(true)

    const novelty: NoveltyByUrl = Object.fromEntries(SIX_RAW.map((s) => [s.url, 'continuing_coverage'])) as NoveltyByUrl
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    expect(afterFlag2).toEqual(tier) // no-op

    const scores: ScoresByUrl = Object.fromEntries(SIX_RAW.map((s) => [s.url, 0]))
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    expect(afterFlag3).toEqual(tier) // no-op
  })

  it('tier-1 protection holds across all 3 flags chained together', () => {
    const flags = resolveFlags({ env: {} })
    const tier = assignSourcesByTier(SIX_RAW, flags)
    const novelty: NoveltyByUrl = {
      'wire-1': 'continuing_coverage',
      'national-1': 'continuing_coverage',
      'specialty-1': 'continuing_coverage',
      'regional-1': 'new_since_last_run',
      'regional-2': 'new_since_last_run',
      'emerging-1': 'new_since_last_run',
    }
    const afterFlag2 = applyNoveltyToPaths(tier, novelty, [], flags)
    const scores: ScoresByUrl = {
      'wire-1': 0, 'national-1': 0, 'specialty-1': 0, // would demote tier-1
      'regional-1': 5, 'regional-2': 5, 'emerging-1': 5,
    }
    const afterFlag3 = applyUniquenessToPaths(afterFlag2, scores, DEFAULT_UNIQUENESS_THRESHOLD, flags)
    // All three tier-1 sources must remain at full_debate
    expect(afterFlag3.find((c) => c.url === 'wire-1')!.assignedPath).toBe('full_debate')
    expect(afterFlag3.find((c) => c.url === 'national-1')!.assignedPath).toBe('full_debate')
    expect(afterFlag3.find((c) => c.url === 'specialty-1')!.assignedPath).toBe('full_debate')
  })
})
