import { getAvailableAnalysts, MODERATOR } from '@/lib/debate-config'
import { runRound1 } from '@/agents/debate-round1'
import { runRound2 } from '@/agents/debate-round2'
import { runModerator } from '@/agents/debate-moderator'
import type { Round1Analysis } from '@/agents/debate-round1'
import type { ModeratorOutput } from '@/agents/debate-moderator'
import type { RegionalAnalysis } from '@/agents/regional'

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

export interface DebateResult {
  moderatorOutput: ModeratorOutput
  debateRounds: DebateRoundData[]
  totalCost: number
  modelsUsed: string[]
}

export async function runRegionalDebate(
  region: string,
  sources: Array<{ url: string; title: string; outlet: string; content?: string }>,
  query: string,
  storyId?: string,
  onProgress?: (msg: string) => void,
): Promise<DebateResult> {
  const analysts = getAvailableAnalysts()
  const debateRounds: DebateRoundData[] = []
  let totalCost = 0

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

    return { moderatorOutput: singleModelOutput, debateRounds, totalCost, modelsUsed: [r1.modelName] }
  }

  // === ROUND 1: Independent Analysis (all models in parallel) ===
  const r1Results = await Promise.all(
    analysts.map(async (model) => {
      try {
        const result = await runRound1(model, region, sources, query, storyId)
        debateRounds.push({
          region, round: 1, modelName: result.modelName, provider: result.provider,
          content: result.analysis, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd,
        })
        totalCost += result.costUsd
        return { modelName: result.modelName, analysis: result.analysis, provider: result.provider }
      } catch (err) {
        console.error(`[Debate R1] ${model.name} failed for ${region}:`, err)
        return null
      }
    }),
  )
  const validR1 = r1Results.filter((r): r is NonNullable<typeof r> => r !== null)

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
    return { moderatorOutput: fallbackOutput, debateRounds, totalCost, modelsUsed: validR1.map(r => r.modelName) }
  }

  // === ROUND 2: Cross-Examination (all models in parallel) ===
  onProgress?.(`R2: Cross-examination in ${region}...`)

  const r2Results = await Promise.all(
    validR1.map(async (own) => {
      const analyst = analysts.find(a => a.name === own.modelName)
      if (!analyst) return null
      const others = validR1.filter(r => r.modelName !== own.modelName)
      try {
        const result = await runRound2(analyst, region, own.analysis, others, sources, query, storyId)
        debateRounds.push({
          region, round: 2, modelName: result.modelName, provider: result.provider,
          content: result.analysis, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd,
        })
        totalCost += result.costUsd
        return { modelName: result.modelName, analysis: result.analysis }
      } catch (err) {
        console.error(`[Debate R2] ${own.modelName} failed for ${region}:`, err)
        return null
      }
    }),
  )
  const validR2 = r2Results.filter((r): r is NonNullable<typeof r> => r !== null)

  onProgress?.(`R2 complete: ${validR2.length} cross-examinations for ${region}`)

  // === ROUND 3: Moderator Synthesis ===
  onProgress?.(`R3: Moderator synthesizing ${region}...`)

  const modResult = await runModerator(region, validR1, validR2, sources, query, storyId)
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
