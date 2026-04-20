/**
 * Per-region tier dispatch — splits sources by Flag 1 path, runs the
 * appropriate sub-analysis (full debate / two-model debate / haiku summary),
 * and merges the results into one RegionalAnalysis the synthesis stage can
 * consume unchanged.
 *
 * Three pieces:
 *   - mergeRegionalAnalyses() — pure: combine 1-3 sub-region analyses into one.
 *   - estimateFullDebateCost() — pure: compute "what would this have cost
 *     under PIPELINE_FORCE_FULL_QUALITY" for telemetry.
 *   - dispatchRegionByTier() — orchestration: classify, run sub-analyses
 *     in parallel, merge, return result + telemetry.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import type { RegionalAnalysis } from '@/agents/regional'
import { runRegionalDebate, type DebateResult } from '@/lib/debate'
import { moderatorToRegionalAnalysis } from '@/lib/debate'
import { summarizeSourcesViaHaiku, type SourceForHaiku } from '@/lib/source-haiku-summary'
import {
  assignSourcesByTier,
  assertTier1FullDebate,
  type DebatePath,
  type PipelineFlags,
  type SourceForTierAssignment,
} from '@/lib/pipeline-flags'
import type { ModelProvider } from '@/lib/models'

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/** Providers used in the two-model debate variant under Flag 1. Claude + Grok. */
export const TWO_MODEL_PROVIDERS: readonly ModelProvider[] = ['anthropic', 'xai']

/**
 * Fallback per-source full-debate cost used in estimateFullDebateCost when
 * no full-debate sources actually ran in this analysis (so we can\u2019t derive
 * the rate empirically). $0.20/source is a conservative midpoint based on
 * production debate runs.
 */
export const FALLBACK_FULL_PER_SOURCE_USD = 0.20

// ─────────────────────────────────────────────────────────────────────────
// Pure: merge multiple RegionalAnalysis (one per tier path) into one
// ─────────────────────────────────────────────────────────────────────────

/**
 * Combine 1-3 sub-region analyses (e.g., [full, two_model, haiku] all for the
 * same region) into a single RegionalAnalysis. Synthesis sees the same shape
 * it always has — Flag 1 is invisible to synthesis.
 *
 * Merge semantics:
 *   - region: validated equal across all sub-analyses; preserved.
 *   - claims, discrepancies, omissions, sourceSummaries: concatenated in order.
 *   - framing: first non-empty framing wins (caller passes [full, two, haiku]
 *     so the highest-tier sub-analysis\u2019s framing is preferred).
 *   - notableAngles: union across all (dedup, first-occurrence order).
 *   - costUsd: summed.
 */
export function mergeRegionalAnalyses(parts: ReadonlyArray<RegionalAnalysis>): RegionalAnalysis {
  if (parts.length === 0) throw new Error('mergeRegionalAnalyses requires at least one input')
  const region = parts[0].region
  for (const p of parts) {
    if (p.region !== region) {
      throw new Error(`mergeRegionalAnalyses requires all parts in the same region (got "${region}" and "${p.region}")`)
    }
  }
  if (parts.length === 1) return parts[0]

  const claims: RegionalAnalysis['claims'] = []
  const discrepancies: RegionalAnalysis['discrepancies'] = []
  const omissions: RegionalAnalysis['omissions'] = []
  const sourceSummaries: RegionalAnalysis['sourceSummaries'] = []
  const angleSeen = new Set<string>()
  const notableAngles: string[] = []
  let framing = ''
  let costUsd = 0

  for (const p of parts) {
    claims.push(...p.claims)
    discrepancies.push(...p.discrepancies)
    omissions.push(...p.omissions)
    sourceSummaries.push(...p.sourceSummaries)
    if (!framing && p.framingAnalysis.framing) framing = p.framingAnalysis.framing
    for (const angle of p.framingAnalysis.notableAngles) {
      if (angle && !angleSeen.has(angle)) {
        angleSeen.add(angle)
        notableAngles.push(angle)
      }
    }
    costUsd += p.costUsd
  }

  return {
    region,
    claims,
    discrepancies,
    framingAnalysis: { framing, notableAngles },
    omissions,
    sourceSummaries,
    costUsd,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pure: estimate what cost would have been under PIPELINE_FORCE_FULL_QUALITY
// ─────────────────────────────────────────────────────────────────────────

export interface FullDebateCostInput {
  fullDebateCount: number
  fullDebateActualCost: number
  twoModelCount: number
  twoModelActualCost: number
  haikuCount: number
  haikuActualCost: number
}

export interface FullDebateCostEstimate {
  estimatedFullCostUsd: number
  actualCostUsd: number
  savingsUsd: number
}

/**
 * Estimate the cost this analysis would have incurred if every source had
 * gone through full debate (force-full equivalent). Uses observed
 * full-debate cost-per-source as the rate when available; falls back to
 * FALLBACK_FULL_PER_SOURCE_USD ($0.20) when no full-debate sources ran.
 *
 * Pure function. Used by the per-flag savings telemetry.
 */
export function estimateFullDebateCost(input: FullDebateCostInput): FullDebateCostEstimate {
  const actualCostUsd =
    input.fullDebateActualCost + input.twoModelActualCost + input.haikuActualCost

  const totalSources = input.fullDebateCount + input.twoModelCount + input.haikuCount
  if (totalSources === 0) {
    return { estimatedFullCostUsd: 0, actualCostUsd: 0, savingsUsd: 0 }
  }

  const observedRate =
    input.fullDebateCount > 0
      ? input.fullDebateActualCost / input.fullDebateCount
      : FALLBACK_FULL_PER_SOURCE_USD

  const estimatedSkippedCost = (input.twoModelCount + input.haikuCount) * observedRate
  const estimatedFullCostUsd = input.fullDebateActualCost + estimatedSkippedCost

  const savingsUsd = Math.max(0, estimatedFullCostUsd - actualCostUsd)

  return { estimatedFullCostUsd, actualCostUsd, savingsUsd }
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestration: dispatch one region\u2019s sources by tier, return merged result
// ─────────────────────────────────────────────────────────────────────────

/**
 * A source as the dispatch sees it: minimum fields needed to classify and
 * to feed both runRegionalDebate (full + 2-model paths) and
 * summarizeSourcesViaHaiku (haiku path).
 */
export interface DispatchSource extends SourceForTierAssignment {
  url: string
  outlet: string
  title: string
  tier: string
  content?: string
  /** ISO timestamp from RSS/GDELT. Used by Flag 5 (regional_debate_pooling) for tie-breaking. */
  publishedAt?: string
}

export interface DispatchTelemetry {
  region: string
  fullDebateCount: number
  fullDebateCostUsd: number
  twoModelCount: number
  twoModelCostUsd: number
  haikuCount: number
  haikuCostUsd: number
  /** Flag 4 telemetry from this region's full debate (if it ran). 2-model debates
   *  can never exit via Flag 4 (insufficient_models). null when no full debate ran. */
  flag4: {
    consensusExited: boolean
    skipReason: string
    consensusClaimsCount: number
    contestedClaimsCount: number
    assessorCostUsd: number
  } | null
  /** Flag 5 telemetry: count of non-tier-1 sources demoted to haiku because they
   *  fell beyond the per-region top-N cap. */
  flag5DemotedCount: number
}

export interface DispatchResult {
  analysis: RegionalAnalysis
  debateRounds: DebateResult['debateRounds']
  telemetry: DispatchTelemetry
}

/**
 * Run the per-region tier dispatch. Splits sources into 3 buckets by Flag 1
 * classification, runs the appropriate sub-analysis for each non-empty bucket
 * in parallel, merges the up-to-3 results into one RegionalAnalysis, and
 * returns telemetry for the savings writer.
 *
 * When Flag 1 is off (or force-full is on): every source routes to full_debate
 * via assignSourcesByTier, which means only the full debate runs. This is the
 * baseline cost path.
 */
export async function dispatchRegionByTier(
  region: string,
  sources: DispatchSource[],
  query: string,
  flags: PipelineFlags,
  opts: {
    storyId?: string
    onProgress?: (msg: string) => void
    /**
     * Per-source path override. When a source's URL is a key in this map, its
     * tier-derived path is replaced with the override value. Used by Flag 2
     * (arc_rerun_differential): continuing-coverage non-tier-1 sources are
     * overridden to 'haiku_summary'. assertTier1FullDebate fires for every
     * resulting assignment, so any attempt to demote a tier-1 source via
     * this map crashes the dispatch.
     */
    pathOverrides?: ReadonlyMap<string, DebatePath>
  } = {},
): Promise<DispatchResult> {
  // Empty region — return a stub analysis with zero cost.
  if (sources.length === 0) {
    return {
      analysis: {
        region,
        claims: [],
        discrepancies: [],
        framingAnalysis: { framing: '', notableAngles: [] },
        omissions: [],
        sourceSummaries: [],
        costUsd: 0,
      },
      debateRounds: [],
      telemetry: {
        region,
        fullDebateCount: 0, fullDebateCostUsd: 0,
        twoModelCount: 0, twoModelCostUsd: 0,
        haikuCount: 0, haikuCostUsd: 0,
        flag4: null,
        flag5DemotedCount: 0,
      },
    }
  }

  const classified = assignSourcesByTier(sources, flags)
  // Apply pathOverrides (Flag 2/3 hook) on top of tier classification. Every
  // resulting assignment is re-asserted so a tier-1 source can never be
  // demoted via the override path, even if the caller tries.
  const afterOverrides = opts.pathOverrides
    ? classified.map((c) => {
        const override = opts.pathOverrides!.get(c.url)
        if (!override || override === c.assignedPath) return c
        const next = { ...c, assignedPath: override }
        assertTier1FullDebate(
          { tier: next.tier, assignedPath: next.assignedPath },
          'arc_rerun_differential',
        )
        return next
      })
    : classified

  // ── Flag 5 (regional_debate_pooling): per-region top-N cap ──
  // Caps full-debate + two-model debate sources at REGIONAL_POOL_CAP per region.
  // Sources beyond the cap are demoted to haiku_summary, EXCEPT tier-1 which
  // is always preserved. Operates after Flag 1 tier classification AND after
  // Flag 2/3 path overrides, so the cap is computed against the post-chain
  // classification. Sort: tier rank \u2192 publishedAt asc \u2192 url asc.
  const { applyRegionalPooling } = await import('@/lib/regional-debate-pooling')
  const finalClassified = applyRegionalPooling(
    afterOverrides.map((c) => {
      // Find the source's publishedAt by URL for the sort tie-break
      const matched = sources.find((s) => s.url === c.url)
      return { ...c, publishedAt: matched?.publishedAt }
    }),
    flags,
  )
  // Track Flag 5 demotion count: paths that changed from non-haiku \u2192 haiku
  // between afterOverrides and finalClassified.
  let flag5DemotedCount = 0
  for (let i = 0; i < afterOverrides.length; i++) {
    const before = afterOverrides[i].assignedPath
    const after = finalClassified[i].assignedPath
    if (before !== after && after === 'haiku_summary') flag5DemotedCount++
  }

  const byPath = new Map<DebatePath, DispatchSource[]>([
    ['full_debate', []],
    ['two_model_debate', []],
    ['haiku_summary', []],
  ])
  for (const c of finalClassified) byPath.get(c.assignedPath)!.push(c)

  const fullSources = byPath.get('full_debate')!
  const twoModelSources = byPath.get('two_model_debate')!
  const haikuSources = byPath.get('haiku_summary')!

  // Helper to convert a DebateResult \u2192 RegionalAnalysis
  function debateToRegional(d: DebateResult): RegionalAnalysis {
    return moderatorToRegionalAnalysis(d.moderatorOutput, region, d.totalCost)
  }

  // Run the up-to-3 sub-analyses in parallel. Pass `flags` through to
  // runRegionalDebate so Flag 4 (confidence_threshold_exit) can check R1
  // consensus between rounds and skip R2+R3 when every claim has consensus.
  const [fullResult, twoModelResult, haikuAnalysis] = await Promise.all([
    fullSources.length > 0
      ? runRegionalDebate(region, fullSources, query, opts.storyId, opts.onProgress, undefined, flags)
      : Promise.resolve(null),
    twoModelSources.length > 0
      ? runRegionalDebate(region, twoModelSources, query, opts.storyId, opts.onProgress, TWO_MODEL_PROVIDERS, flags)
      : Promise.resolve(null),
    haikuSources.length > 0
      ? summarizeSourcesViaHaiku(
          region,
          haikuSources.map<SourceForHaiku>((s) => ({
            url: s.url, outlet: s.outlet, title: s.title, content: s.content,
          })),
          query,
          { storyId: opts.storyId },
        )
      : Promise.resolve(null),
  ])

  const parts: RegionalAnalysis[] = []
  const debateRounds: DebateResult['debateRounds'] = []
  if (fullResult) {
    parts.push(debateToRegional(fullResult))
    debateRounds.push(...fullResult.debateRounds)
  }
  if (twoModelResult) {
    parts.push(debateToRegional(twoModelResult))
    debateRounds.push(...twoModelResult.debateRounds)
  }
  if (haikuAnalysis) {
    parts.push(haikuAnalysis)
  }

  // If somehow nothing produced a result (all sub-paths failed to run), build
  // an empty stub so synthesis sees a valid RegionalAnalysis for this region.
  const merged = parts.length > 0
    ? mergeRegionalAnalyses(parts)
    : {
        region,
        claims: [],
        discrepancies: [],
        framingAnalysis: { framing: '', notableAngles: [] },
        omissions: [],
        sourceSummaries: [],
        costUsd: 0,
      }

  return {
    analysis: merged,
    debateRounds,
    telemetry: {
      region,
      fullDebateCount: fullSources.length,
      fullDebateCostUsd: fullResult?.totalCost ?? 0,
      twoModelCount: twoModelSources.length,
      twoModelCostUsd: twoModelResult?.totalCost ?? 0,
      haikuCount: haikuSources.length,
      haikuCostUsd: haikuAnalysis?.costUsd ?? 0,
      flag4: fullResult ? {
        consensusExited: fullResult.flag4.consensusExited,
        skipReason: fullResult.flag4.skipReason,
        consensusClaimsCount: fullResult.flag4.consensusClaimsCount,
        contestedClaimsCount: fullResult.flag4.contestedClaimsCount,
        assessorCostUsd: fullResult.flag4.assessorCostUsd,
      } : null,
      flag5DemotedCount,
    },
  }
}
