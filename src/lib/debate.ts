import { getAvailableAnalysts, MODERATOR, type DebateModel } from '@/lib/debate-config'
import { runRound1 } from '@/agents/debate-round1'
import { runRound2 } from '@/agents/debate-round2'
import { runModerator } from '@/agents/debate-moderator'
import type { Round1Analysis } from '@/agents/debate-round1'
import type { ModeratorOutput } from '@/agents/debate-moderator'
import type { RegionalAnalysis } from '@/agents/regional'
import type { ModelProvider } from '@/lib/models'
import type { PipelineFlags } from '@/lib/pipeline-flags'
import type { Flag4SkipReason } from '@/lib/consensus-assessor'

export interface DebateRoundData {
  region: string
  round: number
  modelName: string
  provider: string
  content: object
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface Flag4Telemetry {
  /** True when Flag 4 caused R2+R3 to be skipped for this region. */
  consensusExited: boolean
  /** Why the flag did/didn't exit. 'all_consensus' \u2192 exited; everything else \u2192 ran R2+R3 normally. */
  skipReason: Flag4SkipReason
  /** Number of claims marked consensus (4/4 or 3/4 with unsubstantive dissent). */
  consensusClaimsCount: number
  /** Number of claims marked contested (must run R2+R3). */
  contestedClaimsCount: number
  /** Cost of the consensus assessor Haiku call. Always billed even when exit=false. */
  assessorCostUsd: number
}

export interface DebateResult {
  moderatorOutput: ModeratorOutput
  debateRounds: DebateRoundData[]
  totalCost: number
  modelsUsed: string[]
  /** Flag 4 telemetry. Always present when runRegionalDebate is called with flags;
   *  defaults to skipReason='flag_off' when flags is undefined. */
  flag4: Flag4Telemetry
}

// ── Consecutive failure tracking — skip models that are having a bad day ──
const SKIP_AFTER_FAILURES = 3
const modelConsecutiveFailures = new Map<string, number>()

/** Reset failure counters at the start of each pipeline run. */
export function resetModelFailureTracking(): void {
  modelConsecutiveFailures.clear()
}

function recordModelFailure(provider: string, region: string, round: string, error: unknown): boolean {
  const count = (modelConsecutiveFailures.get(provider) ?? 0) + 1
  modelConsecutiveFailures.set(provider, count)
  const errMsg = error instanceof Error ? error.message.substring(0, 120) : String(error).substring(0, 120)
  console.warn(`[debate] ${provider} failure #${count} (${region} ${round}): ${errMsg}`)

  if (count >= SKIP_AFTER_FAILURES) {
    console.warn(`[debate] ⚠ ${provider} has failed ${count} consecutive times — SKIPPING for remaining regions`)
    return true // signal: should skip this model going forward
  }
  return false
}

function recordModelSuccess(provider: string): void {
  modelConsecutiveFailures.delete(provider) // reset on success
}

function shouldSkipModel(provider: string): boolean {
  return (modelConsecutiveFailures.get(provider) ?? 0) >= SKIP_AFTER_FAILURES
}

/**
 * Pure filter for an analyst pool given an optional subset of providers.
 * When subset is undefined or empty, returns the input unchanged. When subset
 * is non-empty, returns only the analysts whose provider is in the subset.
 *
 * Used by Flag 1's two-model debate path (typically subset=['anthropic','xai'])
 * and by future flags that need to restrict which models participate.
 *
 * Pure function — no I/O, no side effects, no env reads. Safe to unit-test.
 */
export function filterAnalystsBySubset(
  analysts: readonly DebateModel[],
  subset?: readonly ModelProvider[],
): DebateModel[] {
  if (!subset || subset.length === 0) return [...analysts]
  const allowed = new Set<string>(subset)
  return analysts.filter((a) => allowed.has(a.provider))
}

export async function runRegionalDebate(
  region: string,
  sources: Array<{ url: string; title: string; outlet: string; content?: string }>,
  query: string,
  storyId?: string,
  onProgress?: (msg: string) => void,
  /**
   * Optional restriction on which model providers participate in this debate.
   * When provided, only analysts whose provider matches are used.
   * Used by Flag 1's two-model variant: subset=['anthropic','xai'] gives
   * Claude+Grok only. When undefined, the full available analyst pool runs
   * (existing behavior — unchanged for callers that don't pass this arg).
   */
  analystSubset?: readonly ModelProvider[],
  /**
   * Optional pipeline flags. When provided AND flags.confidence_threshold_exit
   * is on AND validR1.length === 4, the debate may exit early after R1 if all
   * R1 claims reach consensus (Flag 4: confidence_threshold_exit). When omitted,
   * Flag 4 is treated as off and the full R1+R2+R3 debate always runs.
   */
  flags?: PipelineFlags,
): Promise<DebateResult> {
  const analysts = filterAnalystsBySubset(getAvailableAnalysts(), analystSubset)
  const debateRounds: DebateRoundData[] = []
  let totalCost = 0
  // Flag 4 telemetry initial state. Updated below if Flag 4 actually checks.
  let flag4: Flag4Telemetry = {
    consensusExited: false,
    skipReason: 'flag_off',
    consensusClaimsCount: 0,
    contestedClaimsCount: 0,
    assessorCostUsd: 0,
  }

  onProgress?.(`R1: ${analysts.length} models analyzing ${region}...`)

  // If only 1 model available, skip debate — just run R1
  if (analysts.length === 1) {
    const r1 = await runRound1(analysts[0], region, sources, query, storyId)
    totalCost += r1.costUsd
    debateRounds.push({
      region, round: 1, modelName: r1.modelName, provider: r1.provider,
      content: r1.analysis, inputTokens: r1.inputTokens, outputTokens: r1.outputTokens, costUsd: r1.costUsd,
    })

    // Convert single R1 to a minimal moderator output
    const singleModelOutput: ModeratorOutput = {
      region,
      models_participating: [r1.modelName],
      consensus_findings: r1.analysis.key_facts.map(f => ({
        fact: f.fact, confidence: 'HIGH' as const,
        models_agreeing: [r1.modelName], evidence_quality: f.sourcing_type,
        original_source: f.reported_by.join(', '),
      })),
      resolved_disputes: [],
      unresolved_disputes: [],
      caught_errors: [],
      unique_insights: [],
      dominant_framing: r1.analysis.dominant_framing,
      source_quality: r1.analysis.source_quality_assessment,
      omissions: r1.analysis.omissions_detected,
      debate_quality_note: 'Single model analysis — no debate (other API keys not configured)',
    }

    return { moderatorOutput: singleModelOutput, debateRounds, totalCost, modelsUsed: [r1.modelName], flag4 }
  }

  // === ROUND 1: Independent Analysis (all models in parallel) ===
  // Filter out models that have hit the consecutive failure threshold
  const activeAnalysts = analysts.filter(a => {
    if (shouldSkipModel(a.provider)) {
      console.log(`[Debate R1] Skipping ${a.name} for ${region} — too many consecutive failures`)
      return false
    }
    return true
  })

  const r1Results = await Promise.all(
    activeAnalysts.map(async (model) => {
      try {
        const result = await runRound1(model, region, sources, query, storyId)
        debateRounds.push({
          region, round: 1, modelName: result.modelName, provider: result.provider,
          content: result.analysis, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd,
        })
        totalCost += result.costUsd
        recordModelSuccess(model.provider)
        return { modelName: result.modelName, analysis: result.analysis, provider: result.provider }
      } catch (err) {
        recordModelFailure(model.provider, region, 'R1', err)
        console.error(`[Debate R1] ${model.name} failed for ${region}:`, err)
        return null
      }
    }),
  )
  const validR1 = r1Results.filter((r): r is NonNullable<typeof r> => r !== null)

  const skippedModels = analysts.filter(a => shouldSkipModel(a.provider))
  const failedModels = [
    ...analysts
      .filter(a => !validR1.some(r => r.modelName === a.name) && !shouldSkipModel(a.provider))
      .map(a => ({ model: a.name, reason: 'R1 failed or timed out', round: 'R1' })),
    ...skippedModels
      .map(a => ({ model: a.name, reason: `Skipped — ${modelConsecutiveFailures.get(a.provider) ?? 0} consecutive failures`, round: 'R1' })),
  ]

  if (failedModels.length > 0) {
    console.log(`[Debate] ${region}: ${failedModels.length} model(s) failed R1: ${failedModels.map(f => f.model).join(', ')}`)
  }

  onProgress?.(`R1 complete: ${validR1.length} models responded for ${region}`)

  // Need at least 2 models for a debate
  if (validR1.length < 2) {
    // Fall back to single-model output
    const single = validR1[0]
    const fallbackOutput: ModeratorOutput = {
      region, models_participating: single ? [single.modelName] : [],
      consensus_findings: single ? single.analysis.key_facts.map(f => ({
        fact: f.fact, confidence: 'HIGH' as const,
        models_agreeing: [single.modelName], evidence_quality: f.sourcing_type,
        original_source: f.reported_by.join(', '),
      })) : [],
      resolved_disputes: [], unresolved_disputes: [], caught_errors: [], unique_insights: [],
      dominant_framing: single?.analysis.dominant_framing ?? 'Insufficient model responses',
      source_quality: single?.analysis.source_quality_assessment ?? 'Unknown',
      omissions: single?.analysis.omissions_detected ?? [],
      debate_quality_note: `Only ${validR1.length} model(s) responded — debate skipped`,
    }
    return { moderatorOutput: fallbackOutput, debateRounds, totalCost, modelsUsed: validR1.map(r => r.modelName), flag4 }
  }

  // ── Flag 4 (confidence_threshold_exit): consensus check between R1 and R2 ──
  // Skips R2 + R3 ONLY if all R1 claims reach consensus (4/4 or 3/4 with
  // unsubstantive dissent). Conservative on every fallback \u2014 see
  // lib/consensus-assessor.ts for the airtight definition. The non-negotiable
  // assertContestedClaimDebated fires inside the assessor for every per-claim
  // exit decision, so a contested claim can never be silently skipped.
  if (flags) {
    const { decideFlag4Exit } = await import('@/lib/consensus-assessor')
    const decision = await decideFlag4Exit(validR1, region, flags, { storyId })
    flag4 = {
      consensusExited: decision.exit,
      skipReason: decision.skipReason,
      consensusClaimsCount: decision.consensusClaimsCount,
      contestedClaimsCount: decision.contestedClaimsCount,
      assessorCostUsd: decision.assessorCostUsd,
    }
    totalCost += decision.assessorCostUsd
    if (decision.exit) {
      onProgress?.(`Flag 4 consensus exit: ${region} (${decision.consensusClaimsCount} consensus claims, R2/R3 skipped)`)
      return {
        moderatorOutput: decision.syntheticOutput as ModeratorOutput,
        debateRounds, // only R1 rounds
        totalCost,
        modelsUsed: validR1.map((r) => r.modelName),
        flag4,
      }
    }
  }

  // === ROUND 2: Cross-Examination (all models in parallel) ===
  onProgress?.(`R2: Cross-examination in ${region}...`)

  const r2Results = await Promise.all(
    validR1.map(async (own) => {
      const analyst = analysts.find(a => a.name === own.modelName)
      if (!analyst) return null
      // Skip models that crossed the failure threshold during R1
      if (shouldSkipModel(analyst.provider)) {
        console.log(`[Debate R2] Skipping ${analyst.name} for ${region} — too many consecutive failures`)
        return null
      }
      const others = validR1.filter(r => r.modelName !== own.modelName)
      try {
        const result = await runRound2(analyst, region, own.analysis, others, sources, query, storyId)
        debateRounds.push({
          region, round: 2, modelName: result.modelName, provider: result.provider,
          content: result.analysis, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd,
        })
        totalCost += result.costUsd
        recordModelSuccess(analyst.provider)
        return { modelName: result.modelName, analysis: result.analysis }
      } catch (err) {
        recordModelFailure(analyst.provider, region, 'R2', err)
        console.error(`[Debate R2] ${own.modelName} failed for ${region}:`, err)
        return null
      }
    }),
  )
  const validR2 = r2Results.filter((r): r is NonNullable<typeof r> => r !== null)

  onProgress?.(`R2 complete: ${validR2.length} cross-examinations for ${region}`)

  // === ROUND 3: Moderator Synthesis ===
  onProgress?.(`R3: Moderator synthesizing ${region}...`)

  const modResult = await runModerator(region, validR1, validR2, sources, query, storyId, failedModels)
  debateRounds.push({
    region, round: 3, modelName: MODERATOR.name, provider: MODERATOR.provider,
    content: modResult.output, inputTokens: modResult.inputTokens, outputTokens: modResult.outputTokens, costUsd: modResult.costUsd,
  })
  totalCost += modResult.costUsd

  onProgress?.(`Debate complete for ${region}: ${validR1.length} models, $${totalCost.toFixed(4)}`)

  return {
    moderatorOutput: modResult.output,
    debateRounds,
    totalCost,
    modelsUsed: validR1.map(r => r.modelName),
    flag4,
  }
}

/**
 * Convert ModeratorOutput to RegionalAnalysis format so synthesis.ts works unchanged.
 */
export function moderatorToRegionalAnalysis(
  mod: ModeratorOutput,
  region: string,
  totalCost: number,
): RegionalAnalysis {
  // Build claims from consensus findings + resolved disputes + unique insights
  const claims = [
    ...(mod.consensus_findings || []).map(f => ({
      claim: f.fact,
      confidence: f.confidence as 'HIGH' | 'MEDIUM' | 'LOW' | 'DEVELOPING',
      supportedBy: f.models_agreeing || [],
      contradictedBy: [] as string[],
      fullTextVerified: false,
      sourcingType: f.evidence_quality,
      notes: `Consensus: ${(f.models_agreeing || []).join(', ')} agreed. Original source: ${f.original_source}`,
    })),
    ...(mod.resolved_disputes || []).map(d => ({
      claim: d.claim,
      confidence: d.final_confidence as 'HIGH' | 'MEDIUM' | 'LOW' | 'DEVELOPING',
      supportedBy: d.initial_split?.supporting || [],
      contradictedBy: d.initial_split?.opposing || [],
      fullTextVerified: false,
      sourcingType: null as string | null,
      notes: `Dispute resolved: ${d.resolution}`,
    })),
    ...(mod.unique_insights || []).map(u => ({
      claim: u.finding,
      confidence: u.confidence as 'HIGH' | 'MEDIUM' | 'LOW' | 'DEVELOPING',
      supportedBy: [u.found_by],
      contradictedBy: [] as string[],
      fullTextVerified: false,
      sourcingType: null as string | null,
      notes: `Unique insight from ${u.found_by}: ${u.note}`,
    })),
  ]

  // Build discrepancies from unresolved disputes
  const discrepancies = (mod.unresolved_disputes || []).map(d => ({
    issue: d.claim,
    sideA: d.side_a?.position || '',
    sideB: d.side_b?.position || '',
    sourcesA: d.side_a?.models || [],
    sourcesB: d.side_b?.models || [],
    assessment: d.moderator_note,
  }))

  // Build omissions
  const omissions = (mod.omissions || []).map(o => ({
    missing: o,
    presentIn: 'other regions',
    significance: 'Detected by debate moderator',
  }))

  return {
    region,
    claims,
    discrepancies,
    framingAnalysis: {
      framing: mod.dominant_framing || '',
      notableAngles: (mod.caught_errors || []).map(e => `Error caught: ${e.explanation}`),
    },
    omissions,
    sourceSummaries: [],
    costUsd: totalCost,
  }
}
