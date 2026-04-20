/**
 * Flag 4 (confidence_threshold_exit) consensus assessor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE MOST SAFETY-CRITICAL FUNCTION IN THE COST OPTIMIZATION LAYER.
 *
 * The non-negotiable contract: cross-examination rounds must NEVER skip on
 * contested claims. The assessor calls assertContestedClaimDebated() for
 * every single per-claim exit decision, so any future change that would
 * silently skip a contested claim crashes the pipeline immediately.
 *
 * SUBSTANTIVE DISSENT \u2014 the airtight definition (must match the system prompt
 * given to Haiku, and the recomputation logic at the end of this file):
 *
 *   SUBSTANTIVE (\u2192 contested, must run R2/R3):
 *     1. Model explicitly states an INCOMPATIBLE alternative version of the
 *        same event ("Iran did not reopen the Strait" vs "Iran reopened it").
 *     2. Model lists the fact in its contested_claims array.
 *     3. Model includes the fact with a different KEY DETAIL that materially
 *        changes the meaning (e.g. different actor, different timing,
 *        different magnitude that flips the editorial significance).
 *     4. Default when classifier output is ambiguous, missing, or malformed.
 *        (Conservative default \u2014 better to over-debate than under-debate.)
 *
 *   UNSUBSTANTIVE (\u2192 may consensus-exit if 3/4 agree):
 *     1. Model didn't include the fact in key_facts (silence \u2260 disagreement).
 *     2. Model included the fact with paraphrased wording but identical
 *        substantive content.
 *     3. Model included the fact with a different sourcing attribution
 *        ("per Reuters" vs "per AP") but identical substantive content.
 *     4. Model focused on a different aspect of the same event without
 *        contradicting this fact.
 *
 * Consensus rule (recomputed in this file, never trusted from Haiku output):
 *   - 4/4 models in modelsAgreeing                     \u2192 isConsensus = true
 *   - 3/4 models in modelsAgreeing AND !dissentSubstantive \u2192 isConsensus = true
 *   - 3/4 models in modelsAgreeing AND  dissentSubstantive \u2192 isConsensus = false (CONTESTED)
 *   - 2/4 or fewer in modelsAgreeing                   \u2192 isConsensus = false (CONTESTED)
 *
 * allConsensus = every claim has isConsensus = true. If even one claim is
 * contested, the region keeps full R2 + R3 debate.
 *
 * Conservative skip-reason chain (any of these \u2192 no exit):
 *   - validR1.length < 4               \u2192 'insufficient_models'
 *   - sources have no key_facts at all \u2192 'no_claims'
 *   - Haiku call throws                \u2192 'haiku_error'
 *   - JSON parse fails                 \u2192 'parse_failed'
 *   - any per-claim isConsensus=false  \u2192 'contested_claims_present'
 *   - all per-claim isConsensus=true   \u2192 'all_consensus' (the only exit path)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { assertContestedClaimDebated, type PipelineFlags } from '@/lib/pipeline-flags'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Slim view of a Round1Analysis for consensus assessment. */
export interface R1AnalysisForAssessment {
  modelName: string
  keyFacts: Array<{ fact: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }>
  contestedClaims: Array<{ claim: string }>
}

export interface PerClaimConsensus {
  fact: string
  modelsAgreeing: string[]
  modelsDissenting: string[]
  /** True if at least one dissenter raised substantive contradiction. */
  dissentSubstantive: boolean
  /** Recomputed in this file from agreeing count + substantive flag. Never from Haiku. */
  isConsensus: boolean
}

export type SkipReason =
  | 'all_consensus'              // the only path that allows exit
  | 'insufficient_models'        // need 4 valid R1 results
  | 'no_claims'                  // R1 produced no facts to assess
  | 'haiku_error'                // Haiku call failed
  | 'parse_failed'               // Haiku response not valid JSON
  | 'contested_claims_present'   // at least one claim contested

export interface ConsensusAssessmentResult {
  perClaim: PerClaimConsensus[]
  allConsensus: boolean
  skipReason: SkipReason
  costUsd: number
}

/**
 * Caller signature for callClaude. Default is the real callClaude wrapper;
 * tests inject a stub to avoid API spend.
 */
export type ClaudeCaller = (options: {
  model: string
  systemPrompt: string
  userPrompt: string
  agentType: string
  maxTokens?: number
  region?: string
  storyId?: string
}) => Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_VALID_R1_COUNT = 4
const MIN_AGREEING_FOR_3_OF_4 = 3

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a debate-consensus assessor in the Overcurrent pipeline. Four AI models independently analyzed the same news sources in Round 1. Your job: identify which factual claims have CONSENSUS across all 4 models (or 3 of 4 with the dissenter being unsubstantive) versus which claims are CONTESTED.

This determines whether the system can SKIP the expensive Round 2 cross-examination and Round 3 moderator synthesis. Skipping is allowed ONLY when EVERY claim is consensus. Even one contested claim means full R2 + R3 must run.

For each distinct factual claim that appears in any model's key_facts, identify:
  - modelsAgreeing: models that included this exact fact (or a paraphrase with identical substantive content)
  - modelsDissenting: models that did NOT include this fact OR included an incompatible alternative
  - dissentSubstantive: true if at least one dissenter ACTIVELY contradicts the fact; false if dissenters merely omitted it

SUBSTANTIVE DISSENT \u2014 mark dissentSubstantive=true when:
  - A dissenting model includes an INCOMPATIBLE alternative version of the same event
  - A dissenting model lists this fact in their contested_claims array
  - A dissenting model includes the fact with a key detail that materially changes meaning (different actor, timing, or magnitude that flips editorial significance)
  - You are uncertain whether the dissent is substantive or not (DEFAULT: substantive \u2014 better to over-debate than under-debate)

UNSUBSTANTIVE DISSENT \u2014 mark dissentSubstantive=false when:
  - The dissenting model simply didn't mention the fact (silence \u2260 disagreement)
  - The dissenting model paraphrased the same fact with different wording
  - The dissenting model attributed it to a different source but with same substantive content
  - The dissenting model focused on a different aspect of the same event without contradicting this fact

Recognize semantic equivalence: "Iran reopened the Strait" and "Iran briefly reopened the Strait of Hormuz" are the SAME claim. Different sourcing attribution \u2260 different claim. Paraphrasing \u2260 contradiction.

A model that contradicts a fact AND the contradiction concerns the SAME EVENT is substantive. A model that just doesn't mention the fact is not substantive.

When in any doubt about whether dissent is substantive, mark it substantive=true. The cost system prefers under-skipping debate to over-skipping.

RESPOND WITH JSON ONLY. No markdown, no prose outside the JSON. Shape:
{
  "perClaim": [
    {
      "fact": "<the factual claim text>",
      "modelsAgreeing": ["<model name>", ...],
      "modelsDissenting": ["<model name>", ...],
      "dissentSubstantive": true | false
    }
  ]
}

Include EVERY distinct fact that appears in any model's key_facts.`

function buildUserPrompt(r1s: ReadonlyArray<R1AnalysisForAssessment>, region: string): string {
  const blocks = r1s
    .map((r1) => {
      const factsBlock = r1.keyFacts
        .map((f, i) => `    ${i + 1}. (${f.confidence}) ${f.fact}`)
        .join('\n')
      const contestedBlock = r1.contestedClaims
        .map((c, i) => `    ${i + 1}. ${c.claim}`)
        .join('\n')
      return `MODEL: ${r1.modelName}
  key_facts:
${factsBlock || '    (none)'}
  contested_claims:
${contestedBlock || '    (none)'}`
    })
    .join('\n\n')
  return `REGION: ${region}

ROUND 1 OUTPUTS (${r1s.length} models):

${blocks}

Identify each distinct factual claim and assess consensus per the rules. Return the JSON.`
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function assessClaimConsensus(
  r1s: ReadonlyArray<R1AnalysisForAssessment>,
  region: string,
  opts: { storyId?: string; claudeCaller?: ClaudeCaller } = {},
): Promise<ConsensusAssessmentResult> {
  // Conservative skip 1: need exactly 4 R1 results to run the 4/4-or-3/4 logic.
  if (r1s.length < REQUIRED_VALID_R1_COUNT) {
    return {
      perClaim: [],
      allConsensus: false,
      skipReason: 'insufficient_models',
      costUsd: 0,
    }
  }

  // Conservative skip 2: nothing to assess if no R1 produced any key_facts.
  const totalFacts = r1s.reduce((acc, r) => acc + r.keyFacts.length, 0)
  if (totalFacts === 0) {
    return {
      perClaim: [],
      allConsensus: false,
      skipReason: 'no_claims',
      costUsd: 0,
    }
  }

  const caller = opts.claudeCaller ?? (callClaude as unknown as ClaudeCaller)
  const userPrompt = buildUserPrompt(r1s, region)

  let result: { text: string; inputTokens: number; outputTokens: number; costUsd: number }
  try {
    result = await caller({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'consensus_threshold_exit',
      maxTokens: 2048,
      region,
      storyId: opts.storyId,
    })
  } catch (err) {
    console.error(
      `[consensus-assessor] Haiku call failed for region=${region}; defaulting to no exit:`,
      err instanceof Error ? err.message : err,
    )
    return { perClaim: [], allConsensus: false, skipReason: 'haiku_error', costUsd: 0 }
  }

  let parsed: { perClaim?: unknown }
  try {
    parsed = parseJSON(result.text)
  } catch (err) {
    console.warn(
      `[consensus-assessor] JSON parse failed for region=${region}; defaulting to no exit:`,
      err instanceof Error ? err.message : err,
    )
    return { perClaim: [], allConsensus: false, skipReason: 'parse_failed', costUsd: result.costUsd }
  }

  // Defaulting + normalization. Always recompute isConsensus from agreeingCount
  // + dissentSubstantive \u2014 never trust a Haiku "isConsensus" field if present.
  const rawArray = Array.isArray(parsed?.perClaim) ? parsed.perClaim : []
  const perClaim: PerClaimConsensus[] = []
  for (const raw of rawArray) {
    const r = (raw ?? {}) as Record<string, unknown>
    const fact = typeof r.fact === 'string' ? r.fact : ''
    const modelsAgreeing = Array.isArray(r.modelsAgreeing) ? r.modelsAgreeing.map(String) : []
    const modelsDissenting = Array.isArray(r.modelsDissenting) ? r.modelsDissenting.map(String) : []
    // Conservative default: missing or non-boolean \u2192 substantive (treat as contested)
    const dissentSubstantive = r.dissentSubstantive === false ? false : true

    // RECOMPUTE isConsensus locally. The non-negotiable rule lives in code,
    // not in the LLM response. Haiku cannot grant exit by setting a flag.
    const agreeingCount = modelsAgreeing.length
    const isConsensus =
      (agreeingCount === REQUIRED_VALID_R1_COUNT) ||
      (agreeingCount >= MIN_AGREEING_FOR_3_OF_4 && agreeingCount < REQUIRED_VALID_R1_COUNT && !dissentSubstantive)

    perClaim.push({ fact, modelsAgreeing, modelsDissenting, dissentSubstantive, isConsensus })
  }

  // Empty perClaim after normalization \u2192 no-claims (don't exit on Haiku
  // returning an empty perClaim when we know R1 had facts).
  if (perClaim.length === 0) {
    return { perClaim: [], allConsensus: false, skipReason: 'no_claims', costUsd: result.costUsd }
  }

  const allConsensus = perClaim.every((c) => c.isConsensus)

  // ── Non-negotiable assertion: fire for every per-claim exit decision ──
  // This is the airtight backstop. If a claim is contested but the assessment
  // says skip cross-examination, the assertion crashes the pipeline. Because
  // we recompute isConsensus locally above, this should never throw \u2014 but
  // the assertion catches any future logic bug that breaks that invariant.
  for (let i = 0; i < perClaim.length; i++) {
    const c = perClaim[i]
    const isContested = !c.isConsensus
    const willSkipCrossExam = allConsensus // we only skip when ALL claims are consensus
    assertContestedClaimDebated({
      claimId: `${region}#${i}:${c.fact.substring(0, 40)}`,
      isContested,
      willSkipCrossExam: willSkipCrossExam && isContested,
    })
  }

  const skipReason: SkipReason = allConsensus ? 'all_consensus' : 'contested_claims_present'

  return { perClaim, allConsensus, skipReason, costUsd: result.costUsd }
}

// ─────────────────────────────────────────────────────────────────────────
// buildConsensusOnlyModeratorOutput \u2014 synthesizes a ModeratorOutput from R1
// outputs when Flag 4 triggers an all-consensus exit (skipping R2 + R3).
// ─────────────────────────────────────────────────────────────────────────

/** Slim view of Round1Analysis fields needed to synthesize a ModeratorOutput. */
export interface R1ForSynthesis {
  modelName: string
  analysis: {
    dominant_framing?: string
    source_quality_assessment?: string
    omissions_detected?: string[]
  }
}

interface ModeratorOutputShape {
  region: string
  models_participating: string[]
  consensus_findings: Array<{
    fact: string
    confidence: 'HIGH'
    models_agreeing: string[]
    evidence_quality: string
    original_source: string
  }>
  resolved_disputes: never[]
  unresolved_disputes: never[]
  caught_errors: never[]
  unique_insights: never[]
  dominant_framing: string
  source_quality: string
  omissions: string[]
  debate_quality_note: string
}

function pickMajority(values: string[], fallback: string): string {
  if (values.length === 0) return fallback
  const counts = new Map<string, number>()
  for (const v of values) {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best = fallback
  let bestCount = 0
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v
      bestCount = count
    }
  }
  return best
}

/**
 * Build a synthetic ModeratorOutput from the R1 outputs and the consensus
 * assessment. Used only when Flag 4 triggers all-consensus exit \u2014 R2 and R3
 * are skipped, and the moderator stage's normal output is replaced by this
 * synthesized version.
 *
 * Throws if assessment.allConsensus is false \u2014 caller bug guard. Flag 4 must
 * never call this when contested claims exist.
 */
export function buildConsensusOnlyModeratorOutput(input: {
  region: string
  assessment: ConsensusAssessmentResult
  r1s: ReadonlyArray<R1ForSynthesis>
}): ModeratorOutputShape {
  if (!input.assessment.allConsensus) {
    throw new Error(
      'buildConsensusOnlyModeratorOutput called with allConsensus=false. ' +
      'Flag 4 must only build a synthetic moderator output when every claim is consensus.',
    )
  }

  const models_participating = input.r1s.map((r) => r.modelName)
  const dominant_framing = pickMajority(
    input.r1s.map((r) => r.analysis.dominant_framing ?? '').filter((s) => s.length > 0),
    'Consensus across models',
  )
  const source_quality = pickMajority(
    input.r1s.map((r) => r.analysis.source_quality_assessment ?? '').filter((s) => s.length > 0),
    'Not assessed',
  )

  const omissionSet = new Set<string>()
  for (const r of input.r1s) {
    for (const o of r.analysis.omissions_detected ?? []) {
      const trimmed = String(o).trim()
      if (trimmed.length > 0) omissionSet.add(trimmed)
    }
  }
  const omissions = Array.from(omissionSet)

  const consensus_findings = input.assessment.perClaim.map((c) => ({
    fact: c.fact,
    confidence: 'HIGH' as const,
    models_agreeing: c.modelsAgreeing,
    evidence_quality: c.modelsAgreeing.length === 4 ? 'unanimous' : 'three-of-four',
    original_source: c.modelsAgreeing.join(', '),
  }))

  return {
    region: input.region,
    models_participating,
    consensus_findings,
    resolved_disputes: [],
    unresolved_disputes: [],
    caught_errors: [],
    unique_insights: [],
    dominant_framing,
    source_quality,
    omissions,
    debate_quality_note: `Flag 4 (confidence_threshold_exit): all ${consensus_findings.length} R1 claims reached consensus (4/4 or 3/4 with unsubstantive dissent). R2 cross-examination and R3 moderator synthesis were skipped to save cost. Consensus assessor confirmed no contested claims.`,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// decideFlag4Exit \u2014 the integration helper invoked from runRegionalDebate
// between R1 and R2. Wraps the assessor + synthesizer + flag check + the
// non-negotiable assertion into one call site so the debate orchestration
// stays simple.
// ─────────────────────────────────────────────────────────────────────────

interface ValidR1Like {
  modelName: string
  analysis: {
    key_facts?: Array<{ fact: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }>
    contested_claims?: Array<{ claim: string }>
    dominant_framing?: string
    source_quality_assessment?: string
    omissions_detected?: string[]
  }
}

export type Flag4SkipReason = SkipReason | 'flag_off'

export interface Flag4Decision {
  exit: boolean
  skipReason: Flag4SkipReason
  /** Set when exit=true \u2014 the synthetic ModeratorOutput to return from runRegionalDebate. */
  syntheticOutput?: ModeratorOutputShape
  assessorCostUsd: number
  consensusClaimsCount: number
  contestedClaimsCount: number
}

/**
 * Decide whether Flag 4 (confidence_threshold_exit) can skip R2 + R3 for this
 * region. Called from runRegionalDebate between R1 and R2.
 *
 * Returns exit=true ONLY if all of these hold:
 *   - flags.confidence_threshold_exit is on
 *   - validR1.length === 4 (4-model debate)
 *   - assessor returns allConsensus=true (every claim is consensus)
 *
 * In every other case, exit=false and the caller proceeds with R2 + R3.
 */
export async function decideFlag4Exit(
  validR1: ReadonlyArray<ValidR1Like>,
  region: string,
  flags: PipelineFlags,
  opts: { storyId?: string; claudeCaller?: ClaudeCaller } = {},
): Promise<Flag4Decision> {
  if (!flags.confidence_threshold_exit) {
    return {
      exit: false,
      skipReason: 'flag_off',
      assessorCostUsd: 0,
      consensusClaimsCount: 0,
      contestedClaimsCount: 0,
    }
  }
  if (validR1.length < REQUIRED_VALID_R1_COUNT) {
    return {
      exit: false,
      skipReason: 'insufficient_models',
      assessorCostUsd: 0,
      consensusClaimsCount: 0,
      contestedClaimsCount: 0,
    }
  }

  const r1ForAssessment: R1AnalysisForAssessment[] = validR1.map((r) => ({
    modelName: r.modelName,
    keyFacts: r.analysis.key_facts ?? [],
    contestedClaims: r.analysis.contested_claims ?? [],
  }))

  const assessment = await assessClaimConsensus(r1ForAssessment, region, {
    storyId: opts.storyId,
    claudeCaller: opts.claudeCaller,
  })

  const consensusClaimsCount = assessment.perClaim.filter((c) => c.isConsensus).length
  const contestedClaimsCount = assessment.perClaim.filter((c) => !c.isConsensus).length

  if (!assessment.allConsensus) {
    return {
      exit: false,
      skipReason: assessment.skipReason,
      assessorCostUsd: assessment.costUsd,
      consensusClaimsCount,
      contestedClaimsCount,
    }
  }

  // All consensus \u2014 build the synthetic moderator output and return exit=true.
  const syntheticOutput = buildConsensusOnlyModeratorOutput({
    region,
    assessment,
    r1s: validR1.map((r) => ({ modelName: r.modelName, analysis: r.analysis })),
  })
  return {
    exit: true,
    skipReason: 'all_consensus',
    syntheticOutput,
    assessorCostUsd: assessment.costUsd,
    consensusClaimsCount,
    contestedClaimsCount,
  }
}
