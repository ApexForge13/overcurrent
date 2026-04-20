/**
 * Flag 2 (arc_rerun_differential) helpers:
 *   - pickStabilityCheckSample \u2014 deterministic seeded subset of continuing
 *     sources; per the plan, sample is >0% (never zero) when input is non-empty.
 *   - applyNoveltyToPaths \u2014 overrides assignedPath to 'haiku_summary' for
 *     continuing-coverage sources NOT in the stability sample, EXCEPT tier-1
 *     sources (which the non-negotiable assertion protects: always full_debate).
 *
 * The orchestration layer (pipeline.ts \u2192 dispatchRegionByTier) consumes the
 * overridden classifications. assertTier1FullDebate fires per source as a
 * defensive backstop against any future logic bug that would demote tier-1.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import {
  assertTier1FullDebate,
  type DebatePath,
  type PipelineFlags,
} from '@/lib/pipeline-flags'
import type { Novelty, ClassifierBaseline } from '@/agents/source-novelty-classifier'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fraction of continuing sources sampled into the debate for stability check. */
export const STABILITY_SAMPLE_RATE = 0.20

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map of url \u2192 novelty label. Built from classifySourceNovelty result. */
export type NoveltyByUrl = Record<string, Novelty>

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32) so the 20% sample is reproducible across reruns
// of the same arc. Pure: no I/O, no Date.now, no Math.random.
// ---------------------------------------------------------------------------

function hashStringToSeed(s: string): number {
  // FNV-1a-style 32-bit hash; deterministic from string input.
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// pickStabilityCheckSample
// ---------------------------------------------------------------------------

/**
 * Pick a deterministic subset of items for the Flag 2 stability check.
 * Same seed + same items \u2192 same subset. Sample size = max(1, round(N*rate))
 * when N > 0; never zero (per the plan's risk mitigation).
 *
 * Pure function. No mutation of input.
 */
export function pickStabilityCheckSample<T>(
  items: ReadonlyArray<T>,
  rate: number,
  seed: string,
): T[] {
  const n = items.length
  if (n === 0) return []

  // Treat rate <= 0 or non-finite as default rate, then clamp size to >= 1.
  const effectiveRate = !Number.isFinite(rate) || rate <= 0 ? STABILITY_SAMPLE_RATE : rate
  const target = Math.min(n, Math.max(1, Math.round(n * effectiveRate)))

  // Fisher-Yates with seeded PRNG, take the first `target` items.
  const rng = mulberry32(hashStringToSeed(seed))
  const indices = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }
  return indices.slice(0, target).map((i) => items[i])
}

// ---------------------------------------------------------------------------
// applyNoveltyToPaths
// ---------------------------------------------------------------------------

export interface ClassifiedSource {
  url: string
  tier: string
  assignedPath: DebatePath
  // (other fields preserved via generic extension below)
}

/**
 * Override assignedPath based on Flag 2 novelty classification + stability sample.
 *
 * Rules:
 *   - If Flag 2 is OFF (or PIPELINE_FORCE_FULL_QUALITY): return input unchanged.
 *   - For each source:
 *       \u2022 Tier-1 (wire_service / national / specialty): keep current path.
 *         Tier-1 protection is the non-negotiable assertion; never demote.
 *       \u2022 Source IN stability sample: keep current tier-based path.
 *       \u2022 Source classified as 'new_since_last_run': keep current path.
 *       \u2022 Source classified as 'continuing_coverage' AND not sampled AND
 *         not tier-1: override assignedPath \u2192 'haiku_summary'.
 *
 * assertTier1FullDebate fires per source as a defensive backstop \u2014 if a
 * future refactor accidentally feeds in a misclassified tier-1, the function
 * crashes loudly rather than silently degrading flagship coverage.
 *
 * Pure function. Does not mutate input.
 */
export function applyNoveltyToPaths<T extends ClassifiedSource>(
  classified: ReadonlyArray<T>,
  novelty: NoveltyByUrl,
  stabilitySampleUrls: ReadonlyArray<string>,
  flags: PipelineFlags,
): T[] {
  if (!flags.arc_rerun_differential) {
    // Defensive backstop even on the no-op path
    for (const c of classified) {
      assertTier1FullDebate(
        { tier: c.tier, assignedPath: c.assignedPath },
        'arc_rerun_differential',
      )
    }
    return [...classified]
  }

  const sampleSet = new Set<string>(stabilitySampleUrls)
  const tier1 = new Set(['wire_service', 'national', 'specialty'])

  const result: T[] = []
  for (const source of classified) {
    let assignedPath = source.assignedPath
    if (!tier1.has(source.tier)) {
      const noveltyLabel = novelty[source.url] ?? 'continuing_coverage'
      const isInSample = sampleSet.has(source.url)
      if (noveltyLabel === 'continuing_coverage' && !isInSample) {
        assignedPath = 'haiku_summary'
      }
    }
    assertTier1FullDebate(
      { tier: source.tier, assignedPath },
      'arc_rerun_differential',
    )
    result.push({ ...source, assignedPath })
  }
  return result
}

// ---------------------------------------------------------------------------
// findArcRerunBaseline \u2014 picks the most recent prior arc analysis from a cluster
// ---------------------------------------------------------------------------

/** Cap on key-claims surfaced into the Haiku classifier prompt. Keeps prompt small. */
const KEY_CLAIMS_CAP = 8

/**
 * Shape returned by the baseline fetcher. The DB-backed default reads from
 * Story+Claim; tests inject a synthetic version so unit tests stay pure.
 */
export interface BaselineCandidate {
  id: string
  createdAt: Date
  headline: string
  keyClaims: string[]
  analysisType: 'new_arc' | 'arc_rerun' | string
}

/** Fetcher signature \u2014 returns ALL candidates for the cluster (unsorted ok). */
export type BaselineFetcher = (storyClusterId: string) => Promise<BaselineCandidate[]>

/**
 * Default fetcher \u2014 batch-queries Story+Claim from Prisma. Lazy-imported so
 * unit tests of the pure helpers above don't pull in Prisma at import time.
 *
 * Returns Story rows whose analysisType is 'new_arc' or 'arc_rerun', with
 * the first KEY_CLAIMS_CAP claims (sortOrder ascending) for each.
 */
async function defaultBaselineFetcher(storyClusterId: string): Promise<BaselineCandidate[]> {
  const { prisma } = await import('@/lib/db')
  const stories = await prisma.story.findMany({
    where: {
      storyClusterId,
      analysisType: { in: ['new_arc', 'arc_rerun'] },
    },
    select: {
      id: true,
      createdAt: true,
      headline: true,
      analysisType: true,
      claims: {
        select: { claim: true },
        orderBy: { sortOrder: 'asc' },
        take: KEY_CLAIMS_CAP,
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return stories.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    headline: s.headline,
    keyClaims: s.claims.map((c) => c.claim),
    analysisType: s.analysisType ?? '',
  }))
}

/**
 * Find the baseline for a Flag 2 arc-rerun novelty classifier call.
 * Picks the most recent prior arc analysis from the same StoryCluster
 * (analysisType in 'new_arc' or 'arc_rerun'), excluding the current story
 * if its id is already created. Returns null when no qualifying baseline
 * exists \u2014 callers should treat null as "skip Flag 2 for this run".
 */
export async function findArcRerunBaseline(
  storyClusterId: string | null,
  excludeStoryId?: string,
  fetcher: BaselineFetcher = defaultBaselineFetcher,
): Promise<ClassifierBaseline | null> {
  if (!storyClusterId) return null

  const candidates = await fetcher(storyClusterId)
  if (candidates.length === 0) return null

  // Filter out the current story (when set) and pick the most recent.
  const eligible = candidates
    .filter((c) => (excludeStoryId ? c.id !== excludeStoryId : true))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  if (eligible.length === 0) return null
  const winner = eligible[0]

  return {
    previousAnalysisCreatedAt: winner.createdAt,
    previousHeadline: winner.headline,
    previousKeyClaims: (winner.keyClaims ?? [])
      .slice(0, KEY_CLAIMS_CAP)
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0),
  }
}
