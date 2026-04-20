/**
 * Flag 3 (semantic_dedup) helper:
 *   - applyUniquenessToPaths \u2014 overrides assignedPath to 'haiku_summary'
 *     for non-tier-1 sources whose uniqueness score (from
 *     scoreSourceUniqueness) is below the threshold. Tier-1 sources
 *     (wire_service / national / specialty) are protected by
 *     assertTier1FullDebate and never get demoted regardless of score.
 *
 * The orchestration layer (pipeline.ts) calls scoreSourceUniqueness once per
 * analysis, then passes the resulting scores + tier-classified sources here
 * to compute the final path assignment. The diff between input and output
 * paths is the set of overrides that gets passed to dispatchRegionByTier.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import {
  assertTier1FullDebate,
  type DebatePath,
  type PipelineFlags,
} from '@/lib/pipeline-flags'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default uniqueness score threshold. Sources scoring strictly less than this
 * value are demoted to haiku_summary. Per the user spec (2026-04-19), starts
 * at 4 of 10 and is tuned over the first ~10 analyses to hit the 20-30%
 * source-reduction target.
 */
export const DEFAULT_UNIQUENESS_THRESHOLD = 4

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map of url \u2192 uniqueness score (0-10 integer) from scoreSourceUniqueness. */
export type ScoresByUrl = Record<string, number>

export interface ClassifiedSource {
  url: string
  tier: string
  assignedPath: DebatePath
}

// ---------------------------------------------------------------------------
// applyUniquenessToPaths
// ---------------------------------------------------------------------------

const TIER_1_TIERS_LOCAL = new Set(['wire_service', 'national', 'specialty'])

/**
 * Override assignedPath based on Flag 3 uniqueness scores.
 *
 * Rules:
 *   - If Flag 3 is OFF (or PIPELINE_FORCE_FULL_QUALITY): return input unchanged.
 *   - For each source:
 *       \u2022 Tier-1 (wire_service / national / specialty): keep current path.
 *         Tier-1 protection is the non-negotiable assertion; never demote.
 *       \u2022 Score >= threshold (or score missing, defaulting to 10): keep
 *         current tier-based path.
 *       \u2022 Score < threshold AND not tier-1: override assignedPath \u2192
 *         'haiku_summary'.
 *
 * assertTier1FullDebate fires per source as a defensive backstop \u2014 if a
 * future refactor accidentally feeds in a misclassified tier-1, the function
 * crashes loudly rather than silently degrading flagship coverage.
 *
 * Pure function. Does not mutate input.
 */
export function applyUniquenessToPaths<T extends ClassifiedSource>(
  classified: ReadonlyArray<T>,
  scoresByUrl: ScoresByUrl,
  threshold: number,
  flags: PipelineFlags,
): T[] {
  if (!flags.semantic_dedup) {
    // Defensive backstop even on the no-op path
    for (const c of classified) {
      assertTier1FullDebate(
        { tier: c.tier, assignedPath: c.assignedPath },
        'semantic_dedup',
      )
    }
    return [...classified]
  }

  const result: T[] = []
  for (const source of classified) {
    let assignedPath = source.assignedPath
    if (!TIER_1_TIERS_LOCAL.has(source.tier)) {
      const score = scoresByUrl[source.url] ?? 10 // missing \u2192 conservative
      if (score < threshold) {
        assignedPath = 'haiku_summary'
      }
    }
    assertTier1FullDebate(
      { tier: source.tier, assignedPath },
      'semantic_dedup',
    )
    result.push({ ...source, assignedPath })
  }
  return result
}
