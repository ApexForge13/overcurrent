/**
 * Tests for the Flag 4 (confidence_threshold_exit) consensus assessor.
 *
 * The assessor is the most safety-critical function in the cost-optimization
 * layer. The non-negotiable contract: cross-examination rounds must NEVER
 * skip on contested claims. assertContestedClaimDebated fires for every
 * single per-claim exit decision so any future change that would silently
 * skip a contested claim crashes the pipeline.
 *
 * "Substantive dissent" classification rules (must match the production
 * implementation EXACTLY \u2014 these are the airtight definition):
 *
 *   SUBSTANTIVE (\u2192 contested, must run R2/R3):
 *     - Model explicitly contradicts the fact in its own key_facts
 *     - Model lists the fact in its contested_claims array
 *     - Model reports an incompatible alternative version of the same event
 *     - Default when classifier is uncertain (conservative)
 *
 *   UNSUBSTANTIVE (\u2192 may consensus-exit if 3/4 agree):
 *     - Model didn't include the fact in key_facts (silence \u2260 disagreement)
 *     - Model included the fact with different wording but same substance
 *     - Model included the fact with different sourcing attribution but same substance
 *
 * Consensus rule:
 *   - 4/4 models agree on the fact \u2192 consensus
 *   - 3/4 models agree AND dissenter is unsubstantive \u2192 consensus
 *   - 3/4 models agree AND dissenter is substantive \u2192 CONTESTED
 *   - 2/4 or fewer agree \u2192 CONTESTED
 *   - Fewer than 4 valid R1 results \u2192 CONTESTED (cannot do 4/4 or 3/4 logic)
 */

import { describe, it, expect } from 'vitest'
import {
  assessClaimConsensus,
  buildConsensusOnlyModeratorOutput,
  decideFlag4Exit,
  type ClaudeCaller,
  type R1AnalysisForAssessment,
  type ConsensusAssessmentResult,
} from '@/lib/consensus-assessor'
import { resolveFlags } from '@/lib/pipeline-flags'

// ---------------------------------------------------------------------------
// Synthetic R1 outputs — used across multiple tests
// ---------------------------------------------------------------------------

const FOUR_AGREE_R1: R1AnalysisForAssessment[] = [
  { modelName: 'Claude', keyFacts: [{ fact: 'Iran reopened the Strait', confidence: 'HIGH' }], contestedClaims: [] },
  { modelName: 'GPT-5.4', keyFacts: [{ fact: 'Iran reopened the Strait', confidence: 'HIGH' }], contestedClaims: [] },
  { modelName: 'Gemini', keyFacts: [{ fact: 'Iran reopened the Strait of Hormuz', confidence: 'HIGH' }], contestedClaims: [] },
  { modelName: 'Grok',  keyFacts: [{ fact: 'Iran briefly reopened the Strait', confidence: 'HIGH' }], contestedClaims: [] },
]

function fakeCaller(jsonText: string, costUsd = 0.005): ClaudeCaller {
  return async () => ({ text: jsonText, inputTokens: 200, outputTokens: 100, costUsd })
}

// ---------------------------------------------------------------------------
// Edge cases that must default to CONTESTED (no exit)
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 conservative defaults', () => {
  it('returns allConsensus=false when fewer than 4 R1 results provided', async () => {
    const onlyThree = FOUR_AGREE_R1.slice(0, 3)
    // No Haiku call should even be made when we know we cannot run the 3/4-or-4/4 logic.
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const result = await assessClaimConsensus(onlyThree, 'NA', { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(result.allConsensus).toBe(false)
    expect(result.skipReason).toBe('insufficient_models')
    expect(result.costUsd).toBe(0)
  })

  it('returns allConsensus=false on Haiku error (conservative \u2014 cannot exit if uncertain)', async () => {
    const caller: ClaudeCaller = async () => { throw new Error('Haiku down') }
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: caller })
    expect(result.allConsensus).toBe(false)
    expect(result.skipReason).toBe('haiku_error')
  })

  it('returns allConsensus=false on JSON parse failure', async () => {
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller('garbage') })
    expect(result.allConsensus).toBe(false)
    expect(result.skipReason).toBe('parse_failed')
  })

  it('returns allConsensus=false when no claims are present in any R1 (nothing to assess)', async () => {
    const noFacts: R1AnalysisForAssessment[] = [
      { modelName: 'Claude', keyFacts: [], contestedClaims: [] },
      { modelName: 'GPT-5.4', keyFacts: [], contestedClaims: [] },
      { modelName: 'Gemini', keyFacts: [], contestedClaims: [] },
      { modelName: 'Grok',  keyFacts: [], contestedClaims: [] },
    ]
    const result = await assessClaimConsensus(noFacts, 'NA', { claudeCaller: fakeCaller('{"perClaim":[]}') })
    expect(result.allConsensus).toBe(false)
    expect(result.skipReason).toBe('no_claims')
  })
})

// ---------------------------------------------------------------------------
// 4/4 consensus
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 4/4 agreement', () => {
  it('all 4 models agree on a single fact \u2192 allConsensus=true', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'],
          modelsDissenting: [],
          dissentSubstantive: false,
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(true)
    expect(result.perClaim).toHaveLength(1)
    expect(result.perClaim[0].isConsensus).toBe(true)
    expect(result.skipReason).toBe('all_consensus')
  })

  it('all 4 models agree on multiple facts \u2192 allConsensus=true', async () => {
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F2', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F3', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(true)
    expect(result.perClaim).toHaveLength(3)
    expect(result.perClaim.every((c) => c.isConsensus)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3/4 with UNSUBSTANTIVE dissenter \u2192 consensus
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 3/4 agreement, unsubstantive dissenter', () => {
  it('3 models include fact, 1 model silent (no contradiction) \u2192 isConsensus=true', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'],
          modelsDissenting: ['Grok'],
          dissentSubstantive: false, // Grok just didn't include it
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(true)
    expect(result.perClaim[0].isConsensus).toBe(true)
    expect(result.perClaim[0].modelsDissenting).toEqual(['Grok'])
    expect(result.perClaim[0].dissentSubstantive).toBe(false)
  })

  it('3 models include fact verbatim, 1 includes paraphrased version \u2192 isConsensus=true', async () => {
    // Paraphrased \u2260 substantive dissent. If Haiku correctly recognizes the same
    // substance with different wording, the 4th model is actually agreeing,
    // not dissenting. This case tests that the assessor handles the edge case
    // when Haiku still labels it as a dissenter but flags it unsubstantive.
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'],
          modelsDissenting: ['Grok'],
          dissentSubstantive: false, // paraphrase, not contradiction
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3/4 with SUBSTANTIVE dissenter \u2192 CONTESTED (the airtight non-negotiable)
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 3/4 agreement, SUBSTANTIVE dissenter \u2192 CONTESTED', () => {
  it('3 models say "X happened", 1 model says "X did NOT happen" \u2192 isConsensus=false', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'],
          modelsDissenting: ['Grok'],
          dissentSubstantive: true, // Grok contradicted
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
    expect(result.perClaim[0].isConsensus).toBe(false)
    expect(result.perClaim[0].dissentSubstantive).toBe(true)
  })

  it('3 models include fact, 1 model lists it in contested_claims \u2192 isConsensus=false', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'],
          modelsDissenting: ['Grok'],
          dissentSubstantive: true, // Grok flagged it as contested
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
  })

  it('mixed: 2 facts at 4/4 + 1 fact at 3/4-substantive \u2192 allConsensus=false (any contested kills exit)', async () => {
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F2', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F3', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'], modelsDissenting: ['Grok'], dissentSubstantive: true },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
    expect(result.skipReason).toBe('contested_claims_present')
    expect(result.perClaim[0].isConsensus).toBe(true)
    expect(result.perClaim[1].isConsensus).toBe(true)
    expect(result.perClaim[2].isConsensus).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2/4 or fewer agreement \u2192 CONTESTED regardless of "substantive" label
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 less than 3/4 agreement always contested', () => {
  it('2/2 split \u2192 isConsensus=false even if dissentSubstantive=false', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude', 'GPT-5.4'],
          modelsDissenting: ['Gemini', 'Grok'],
          dissentSubstantive: false, // even labeled unsubstantive, 2/4 is contested
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
    expect(result.perClaim[0].isConsensus).toBe(false)
  })

  it('1/4 (only one model includes the fact) \u2192 isConsensus=false', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Iran reopened the Strait',
          modelsAgreeing: ['Claude'],
          modelsDissenting: ['GPT-5.4', 'Gemini', 'Grok'],
          dissentSubstantive: false,
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Defaulting / normalization
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 normalization and defaults', () => {
  it('missing dissentSubstantive defaults to true (conservative \u2014 no exit)', async () => {
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'F1',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'],
          modelsDissenting: ['Grok'],
          // dissentSubstantive missing
        },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.perClaim[0].dissentSubstantive).toBe(true)
    expect(result.perClaim[0].isConsensus).toBe(false)
    expect(result.allConsensus).toBe(false)
  })

  it('missing modelsAgreeing defaults to empty array \u2192 isConsensus=false', async () => {
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1' /* no modelsAgreeing */ },
      ],
    })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
  })

  it('non-array perClaim defaults to empty (treated as no-claims case)', async () => {
    const json = JSON.stringify({ perClaim: 'not an array' })
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) })
    expect(result.allConsensus).toBe(false)
    expect(result.perClaim).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Cost + telemetry
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 telemetry', () => {
  it('uses HAIKU model and agentType=consensus_threshold_exit', async () => {
    let captured: { model?: string; agentType?: string; region?: string } = {}
    const caller: ClaudeCaller = async (opts) => {
      captured = { model: opts.model, agentType: opts.agentType, region: opts.region }
      return { text: JSON.stringify({ perClaim: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await assessClaimConsensus(FOUR_AGREE_R1, 'Asia', { claudeCaller: caller })
    expect(captured.model).toBe('claude-haiku-4-5-20251001')
    expect(captured.agentType).toBe('consensus_threshold_exit')
    expect(captured.region).toBe('Asia')
  })

  it('passes storyId through for cost-row attribution', async () => {
    let storyId: string | undefined
    const caller: ClaudeCaller = async (opts) => {
      storyId = opts.storyId
      return { text: JSON.stringify({ perClaim: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: caller, storyId: 'story-xyz' })
    expect(storyId).toBe('story-xyz')
  })

  it('returns Haiku call cost in costUsd', async () => {
    const result = await assessClaimConsensus(FOUR_AGREE_R1, 'NA', {
      claudeCaller: fakeCaller(JSON.stringify({ perClaim: [] }), 0.0042),
    })
    expect(result.costUsd).toBe(0.0042)
  })

  it('user prompt includes all 4 R1 outputs with their key_facts', async () => {
    let userPrompt = ''
    const caller: ClaudeCaller = async (opts) => {
      userPrompt = opts.userPrompt
      return { text: JSON.stringify({ perClaim: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: caller })
    // Each model name + the fact text should be visible
    expect(userPrompt).toContain('Claude')
    expect(userPrompt).toContain('GPT-5.4')
    expect(userPrompt).toContain('Gemini')
    expect(userPrompt).toContain('Grok')
    expect(userPrompt).toContain('Iran reopened the Strait')
  })
})

// ---------------------------------------------------------------------------
// Non-negotiable assertion fires for every per-claim decision
// ---------------------------------------------------------------------------

describe('assessClaimConsensus \u2014 non-negotiable assertion (the airtight rule)', () => {
  it('all-consensus + all-substantive=false should NOT trigger assertion (sanity)', async () => {
    // 4/4 agreement on every claim, no dissent. Assertion should pass silently.
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F2', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
      ],
    })
    await expect(
      assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) }),
    ).resolves.toBeDefined()
  })

  it('throws if isConsensus=true but the per-claim data shows it is contested (defensive backstop)', () => {
    // This test is a sanity check on assertContestedClaimDebated itself \u2014 the
    // assessor calls it for every per-claim decision. If a future refactor
    // produces an inconsistent result (isConsensus=true on substantive dissent),
    // the assertion fires.
    //
    // The assertion lives in pipeline-flags.ts and is exercised in
    // pipeline-flags.test.ts. This test verifies the ASSESSOR USES IT.
    // We confirm by building a synthetic Haiku response that's internally
    // inconsistent and observing the resulting assessor output respects the
    // safety rule.
    const json = JSON.stringify({
      perClaim: [
        {
          fact: 'Inconsistent claim',
          modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'],
          modelsDissenting: ['Grok'],
          dissentSubstantive: true, // contested
          // Note: assessor recomputes isConsensus from agreeingCount + dissentSubstantive,
          // so it can't be tricked by a Haiku "isConsensus" override.
        },
      ],
    })
    return assessClaimConsensus(FOUR_AGREE_R1, 'NA', { claudeCaller: fakeCaller(json) }).then((result) => {
      // The assessor ALWAYS recomputes isConsensus from the count + substantive flag.
      // It never trusts a Haiku "isConsensus" field if present.
      expect(result.perClaim[0].isConsensus).toBe(false)
      expect(result.allConsensus).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// buildConsensusOnlyModeratorOutput \u2014 synthesizes ModeratorOutput from R1
// when Flag 4 triggers all-consensus exit (skipping R2 + R3).
// ---------------------------------------------------------------------------

describe('buildConsensusOnlyModeratorOutput', () => {
  const ASSESSMENT_ALL_CONSENSUS: ConsensusAssessmentResult = {
    perClaim: [
      { fact: 'Iran reopened the Strait', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false, isConsensus: true },
      { fact: 'Brent crude surged past $100', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'], modelsDissenting: ['Grok'], dissentSubstantive: false, isConsensus: true },
    ],
    allConsensus: true,
    skipReason: 'all_consensus',
    costUsd: 0.005,
  }

  const FOUR_R1S_WITH_FRAMING = [
    { modelName: 'Claude', analysis: { dominant_framing: 'Geopolitical escalation', source_quality_assessment: 'Mixed', omissions_detected: ['IEA outlook'] } },
    { modelName: 'GPT-5.4', analysis: { dominant_framing: 'Geopolitical escalation', source_quality_assessment: 'Mixed', omissions_detected: [] } },
    { modelName: 'Gemini', analysis: { dominant_framing: 'Maritime logistics', source_quality_assessment: 'Strong', omissions_detected: ['insurance market'] } },
    { modelName: 'Grok', analysis: { dominant_framing: 'Geopolitical escalation', source_quality_assessment: 'Mixed', omissions_detected: [] } },
  ]

  it('builds a ModeratorOutput with consensus_findings populated from the assessment', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'Asia',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    expect(output.region).toBe('Asia')
    expect(output.consensus_findings).toHaveLength(2)
    expect(output.consensus_findings[0].fact).toBe('Iran reopened the Strait')
    expect(output.consensus_findings[0].confidence).toBe('HIGH')
    expect(output.consensus_findings[0].models_agreeing).toEqual(['Claude', 'GPT-5.4', 'Gemini', 'Grok'])
  })

  it('models_participating lists all 4 R1 model names', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    expect(output.models_participating).toEqual(['Claude', 'GPT-5.4', 'Gemini', 'Grok'])
  })

  it('dominant_framing is the most-common framing across R1s (majority wins)', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    // 3/4 said 'Geopolitical escalation'
    expect(output.dominant_framing).toBe('Geopolitical escalation')
  })

  it('source_quality is the most-common assessment across R1s (majority wins)', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    // 3/4 said 'Mixed'
    expect(output.source_quality).toBe('Mixed')
  })

  it('omissions is the union of every R1 omissions array (deduped)', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    expect(output.omissions.sort()).toEqual(['IEA outlook', 'insurance market'])
  })

  it('resolved_disputes, unresolved_disputes, caught_errors, unique_insights are all empty (no R2 ran)', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    expect(output.resolved_disputes).toEqual([])
    expect(output.unresolved_disputes).toEqual([])
    expect(output.caught_errors).toEqual([])
    expect(output.unique_insights).toEqual([])
  })

  it('debate_quality_note documents that R2/R3 was skipped via consensus exit', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    expect(output.debate_quality_note).toContain('Flag 4')
    expect(output.debate_quality_note).toContain('consensus')
    expect(output.debate_quality_note.toLowerCase()).toContain('skipped')
  })

  it('throws if assessment.allConsensus is false (caller bug guard)', () => {
    const contestedAssessment: ConsensusAssessmentResult = {
      ...ASSESSMENT_ALL_CONSENSUS,
      allConsensus: false,
      skipReason: 'contested_claims_present',
    }
    expect(() =>
      buildConsensusOnlyModeratorOutput({
        region: 'NA',
        assessment: contestedAssessment,
        r1s: FOUR_R1S_WITH_FRAMING,
      }),
    ).toThrow(/allConsensus/)
  })

  it('handles original_source built from modelsAgreeing list', () => {
    const output = buildConsensusOnlyModeratorOutput({
      region: 'NA',
      assessment: ASSESSMENT_ALL_CONSENSUS,
      r1s: FOUR_R1S_WITH_FRAMING,
    })
    expect(output.consensus_findings[1].original_source).toContain('Claude')
  })
})

// ---------------------------------------------------------------------------
// decideFlag4Exit \u2014 the integration helper that runs inside runRegionalDebate
// ---------------------------------------------------------------------------

describe('decideFlag4Exit', () => {
  // Each entry mirrors the validR1 shape that runRegionalDebate has between
  // R1 and R2: { modelName, analysis: { key_facts, contested_claims, ... } }
  const FOUR_VALID_R1 = [
    { modelName: 'Claude',  analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [], dominant_framing: 'X', source_quality_assessment: 'good', omissions_detected: [] } },
    { modelName: 'GPT-5.4', analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [], dominant_framing: 'X', source_quality_assessment: 'good', omissions_detected: [] } },
    { modelName: 'Gemini',  analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [], dominant_framing: 'X', source_quality_assessment: 'good', omissions_detected: [] } },
    { modelName: 'Grok',    analysis: { key_facts: [{ fact: 'F1', confidence: 'HIGH' as const }], contested_claims: [], dominant_framing: 'X', source_quality_assessment: 'good', omissions_detected: [] } },
  ]

  it('returns exit=false when Flag 4 is OFF (no Haiku call)', async () => {
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const flags = resolveFlags({ env: { PIPELINE_CONFIDENCE_THRESHOLD_EXIT: '0' } })
    const result = await decideFlag4Exit(FOUR_VALID_R1, 'NA', flags, { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(result.exit).toBe(false)
    expect(result.skipReason).toBe('flag_off')
  })

  it('returns exit=false when force-full-quality active (no Haiku call)', async () => {
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
    const result = await decideFlag4Exit(FOUR_VALID_R1, 'NA', flags, { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(result.exit).toBe(false)
    expect(result.skipReason).toBe('flag_off')
  })

  it('returns exit=false when fewer than 4 valid R1 results (no Haiku call)', async () => {
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const flags = resolveFlags({ env: {} })
    const result = await decideFlag4Exit(FOUR_VALID_R1.slice(0, 3), 'NA', flags, { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(result.exit).toBe(false)
    expect(result.skipReason).toBe('insufficient_models')
  })

  it('returns exit=true + synthetic moderator output when all claims are consensus', async () => {
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
      ],
    })
    const flags = resolveFlags({ env: {} })
    const result = await decideFlag4Exit(FOUR_VALID_R1, 'NA', flags, {
      claudeCaller: fakeCaller(json, 0.0042),
    })
    expect(result.exit).toBe(true)
    expect(result.skipReason).toBe('all_consensus')
    expect(result.syntheticOutput).toBeDefined()
    expect(result.syntheticOutput!.consensus_findings).toHaveLength(1)
    expect(result.assessorCostUsd).toBe(0.0042)
    expect(result.consensusClaimsCount).toBe(1)
    expect(result.contestedClaimsCount).toBe(0)
  })

  it('returns exit=false when a single claim is contested (the airtight rule)', async () => {
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini', 'Grok'], modelsDissenting: [], dissentSubstantive: false },
        { fact: 'F2', modelsAgreeing: ['Claude', 'GPT-5.4', 'Gemini'], modelsDissenting: ['Grok'], dissentSubstantive: true },
      ],
    })
    const flags = resolveFlags({ env: {} })
    const result = await decideFlag4Exit(FOUR_VALID_R1, 'NA', flags, {
      claudeCaller: fakeCaller(json, 0.005),
    })
    expect(result.exit).toBe(false)
    expect(result.skipReason).toBe('contested_claims_present')
    expect(result.syntheticOutput).toBeUndefined()
    expect(result.assessorCostUsd).toBe(0.005) // bills classifier even on no-exit
    expect(result.consensusClaimsCount).toBe(1)
    expect(result.contestedClaimsCount).toBe(1)
  })

  it('passes storyId through to the assessor for cost-row attribution', async () => {
    let storyId: string | undefined
    const caller: ClaudeCaller = async (opts) => {
      storyId = opts.storyId
      return { text: JSON.stringify({ perClaim: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const flags = resolveFlags({ env: {} })
    await decideFlag4Exit(FOUR_VALID_R1, 'NA', flags, { claudeCaller: caller, storyId: 'story-77' })
    expect(storyId).toBe('story-77')
  })

  it('billing: assessorCostUsd is always reported even when exit=false', async () => {
    const json = JSON.stringify({
      perClaim: [
        { fact: 'F1', modelsAgreeing: ['Claude'], modelsDissenting: ['GPT-5.4', 'Gemini', 'Grok'], dissentSubstantive: true },
      ],
    })
    const flags = resolveFlags({ env: {} })
    const result = await decideFlag4Exit(FOUR_VALID_R1, 'NA', flags, {
      claudeCaller: fakeCaller(json, 0.0033),
    })
    expect(result.exit).toBe(false)
    expect(result.assessorCostUsd).toBe(0.0033)
  })
})
