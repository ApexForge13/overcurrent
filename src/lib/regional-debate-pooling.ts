/**
 * Flag 5 (regional_debate_pooling) per-region top-N cap.
 *
 * Caps the full-debate (and two-model debate) source pool at REGIONAL_POOL_CAP
 * sources per region. Sources beyond the cap are demoted to haiku_summary,
 * EXCEPT tier-1 sources (wire_service / national / specialty) which are
 * protected by assertTier1FullDebate \u2014 they always keep their tier-based path
 * regardless of cap.
 *
 * Sort order for cap selection (deterministic):
 *   1. Tier rank ascending (wire_service > national > specialty > regional > emerging > unclassified)
 *   2. publishedAt ascending (earliest first; missing values sort last within tier)
 *   3. URL ascending (deterministic tie-break \u2014 Source.id is not yet assigned at dispatch time)
 *
 * Output preserves input order. The sort is internal, used only to pick which
 * sources are inside vs outside the top-N. The returned array iterates in the
 * same order as the input array, with assignedPath updated where appropriate.
 *
 * Pure function. No I/O. No mutation of input.
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

/** Per-region cap on sources that participate in debate (full or two-model). */
export const REGIONAL_POOL_CAP = 8

/**
 * Tier rank for sort ordering. Lower number = higher priority.
 * The 6 known tiers all have explicit ranks; unknown tiers fall through to
 * an effectively-infinite rank in the sort comparator (treated as least priority).
 */
export const TIER_RANK: Readonly<Record<string, number>> = Object.freeze({
  wire_service: 0,
  national: 1,
  specialty: 2,
  regional: 3,
  emerging: 4,
  unclassified: 5,
})

const UNKNOWN_TIER_RANK = 999

const TIER_1_TIERS_LOCAL = new Set(['wire_service', 'national', 'specialty'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassifiedPoolSource {
  url: string
  tier: string
  assignedPath: DebatePath
  publishedAt?: string
}

// ---------------------------------------------------------------------------
// Sort comparator
// ---------------------------------------------------------------------------

function tierRank(tier: string): number {
  return TIER_RANK[tier] ?? UNKNOWN_TIER_RANK
}

/** Parse publishedAt to a sortable number; missing/invalid \u2192 +Infinity (sorts last). */
function publishedAtSortKey(publishedAt?: string): number {
  if (!publishedAt) return Number.POSITIVE_INFINITY
  const t = Date.parse(publishedAt)
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

function compareSources(a: ClassifiedPoolSource, b: ClassifiedPoolSource): number {
  const tierDiff = tierRank(a.tier) - tierRank(b.tier)
  if (tierDiff !== 0) return tierDiff
  const tsDiff = publishedAtSortKey(a.publishedAt) - publishedAtSortKey(b.publishedAt)
  if (tsDiff !== 0) return tsDiff
  // URL ascending, deterministic
  if (a.url < b.url) return -1
  if (a.url > b.url) return 1
  return 0
}

// ---------------------------------------------------------------------------
// applyRegionalPooling
// ---------------------------------------------------------------------------

/**
 * Apply the per-region top-N cap. Sources ranked beyond REGIONAL_POOL_CAP are
 * demoted to haiku_summary, except tier-1 sources which are always preserved
 * (assertTier1FullDebate fires per source as the backstop).
 *
 * Returns a new array preserving input order; never mutates input. When
 * Flag 5 is OFF (or PIPELINE_FORCE_FULL_QUALITY active), returns the input
 * verbatim.
 */
export function applyRegionalPooling<T extends ClassifiedPoolSource>(
  sources: ReadonlyArray<T>,
  flags: PipelineFlags,
): T[] {
  if (!flags.regional_debate_pooling) {
    // Defensive backstop even on the no-op path.
    for (const s of sources) {
      assertTier1FullDebate(
        { tier: s.tier, assignedPath: s.assignedPath },
        'regional_debate_pooling',
      )
    }
    return [...sources]
  }

  // The cap applies to DEBATE participation (full + two-model). Sources already
  // routed to haiku_summary by Flags 1/2/3 don't take cap slots \u2014 they're
  // already out of the debate pool. Filter to non-haiku sources for the
  // ranking, then check whether each non-haiku source fits in the top N.
  const indexed = sources.map((s, originalIndex) => ({ s, originalIndex }))
  const debatePool = indexed.filter(({ s }) => s.assignedPath !== 'haiku_summary')
  const sortedForCap = [...debatePool].sort((a, b) => compareSources(a.s, b.s))
  // Top N indices = the first REGIONAL_POOL_CAP entries' originalIndex values.
  const insideCap = new Set<number>()
  for (let i = 0; i < Math.min(REGIONAL_POOL_CAP, sortedForCap.length); i++) {
    insideCap.add(sortedForCap[i].originalIndex)
  }

  const result: T[] = []
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]
    let assignedPath = s.assignedPath
    // Already-haiku sources are not in the debate pool; no demotion needed.
    if (s.assignedPath !== 'haiku_summary' && !insideCap.has(i) && !TIER_1_TIERS_LOCAL.has(s.tier)) {
      // Beyond cap AND not tier-1 AND currently in debate \u2192 demote to haiku
      assignedPath = 'haiku_summary'
    }
    // Always re-assert. If somehow a tier-1 was already misclassified in input,
    // this throws even on the keep-path.
    assertTier1FullDebate(
      { tier: s.tier, assignedPath },
      'regional_debate_pooling',
    )
    if (assignedPath === s.assignedPath) {
      result.push(s)
    } else {
      result.push({ ...s, assignedPath })
    }
  }
  return result
}
