import { callModel, parseJSON } from '@/lib/models'
import { ANTI_HALLUCINATION_RULES, JSON_RULES } from './prompts'
import type { Round1Analysis } from './debate-round1'
import type { Round2Analysis } from './debate-round2'

export interface ConsensusFinding {
  fact: string
  confidence: 'HIGH'
  models_agreeing: string[]
  evidence_quality: string
  original_source: string
}

export interface ResolvedDispute {
  claim: string
  initial_split: { supporting: string[]; opposing: string[] }
  resolution: string
  winning_evidence: string
  final_confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface UnresolvedDispute {
  claim: string
  side_a: { position: string; models: string[]; evidence: string }
  side_b: { position: string; models: string[]; evidence: string }
  moderator_note: string
}

export interface CaughtError {
  original_claim: string
  claimed_by: string[]
  caught_by: string
  error_type: 'hallucination' | 'mischaracterization' | 'overconfidence' | 'provenance_error'
  explanation: string
}

export interface UniqueInsight {
  finding: string
  found_by: string
  confidence: 'MEDIUM'
  note: string
}

export interface ModeratorOutput {
  region: string
  models_participating: string[]
  consensus_findings: ConsensusFinding[]
  resolved_disputes: ResolvedDispute[]
  unresolved_disputes: UnresolvedDispute[]
  caught_errors: CaughtError[]
  unique_insights: UniqueInsight[]
  dominant_framing: string
  source_quality: string
  omissions: string[]
  debate_quality_note: string
}

export interface ModeratorResult {
  output: ModeratorOutput
  rawText: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function buildSystemPrompt(region: string, query: string): string {
  return `You are the Overcurrent Moderator. You have just observed a 2-round debate between AI models analyzing news coverage from ${region} on the topic: "${query}".

You have:
- Independent Round 1 analyses from each model
- Round 2 cross-examinations where models challenged each other

Your job is to produce the FINAL regional analysis by:

1. CONSENSUS FINDINGS: Claims where most models agree AND no model successfully challenged. These are your highest-confidence findings. Note which models agreed.

2. RESOLVED DISPUTES: Claims where models initially disagreed but one side presented stronger evidence in Round 2. State who was right and why.

3. UNRESOLVED DISPUTES: Claims where models still disagree after cross-examination. Present both sides and explain why it can't be resolved with available evidence.

4. CAUGHT ERRORS: Claims that one or more models made in Round 1 but were successfully challenged in Round 2. Note what was wrong and which model caught it.

5. UNIQUE INSIGHTS: Findings that only one model identified AND were not challenged by others. Include with MEDIUM confidence.

6. PROVENANCE CORRECTIONS: Where Round 2 revealed that apparent multi-source consensus was actually wire syndication. Adjust confidence accordingly.

MODERATION RULES:
- You are impartial. No model gets preference. Evidence quality decides disputes.
- Quantity of models agreeing is not enough — if most agree but one presents concrete counter-evidence, investigate.
- The debate itself is data. Note model names involved in each agreement/dispute.
- "All models agreed" is stronger than "2 agreed, 2 didn't analyze this."

${ANTI_HALLUCINATION_RULES}

${JSON_RULES}

{
  "region": "${region}",
  "models_participating": ["model names"],
  "consensus_findings": [{ "fact": "...", "confidence": "HIGH", "models_agreeing": ["..."], "evidence_quality": "...", "original_source": "..." }],
  "resolved_disputes": [{ "claim": "...", "initial_split": { "supporting": ["..."], "opposing": ["..."] }, "resolution": "...", "winning_evidence": "...", "final_confidence": "HIGH | MEDIUM | LOW" }],
  "unresolved_disputes": [{ "claim": "...", "side_a": { "position": "...", "models": ["..."], "evidence": "..." }, "side_b": { "position": "...", "models": ["..."], "evidence": "..." }, "moderator_note": "..." }],
  "caught_errors": [{ "original_claim": "...", "claimed_by": ["..."], "caught_by": "...", "error_type": "hallucination | mischaracterization | overconfidence | provenance_error", "explanation": "..." }],
  "unique_insights": [{ "finding": "...", "found_by": "...", "confidence": "MEDIUM", "note": "..." }],
  "dominant_framing": "Final assessment of how this region frames the story",
  "source_quality": "Final assessment of source quality",
  "omissions": ["Notable omissions in this region's coverage"],
  "debate_quality_note": "Brief note on how productive the debate was"
}`
}

export async function runModerator(
  region: string,
  r1Results: Array<{ modelName: string; analysis: Round1Analysis }>,
  r2Results: Array<{ modelName: string; analysis: Round2Analysis }>,
  sources: Array<{ url: string; title: string; outlet: string; content?: string }>,
  query: string,
  storyId?: string,
  failedModels?: Array<{ model: string; reason: string; round: string }>,
): Promise<ModeratorResult> {
  const r1Text = r1Results
    .map((r) => `=== ${r.modelName}'s Round 1 Analysis ===\n${JSON.stringify(r.analysis, null, 2)}`)
    .join('\n\n')

  const r2Text = r2Results
    .map((r) => `=== ${r.modelName}'s Round 2 Cross-Examination ===\n${JSON.stringify(r.analysis, null, 2)}`)
    .join('\n\n')

  const sourceText = sources
    .map((s, i) => `[${i + 1}] ${s.outlet}: "${s.title}" — ${s.url}`)
    .join('\n')

  const userPrompt = `Topic: "${query}" | Region: ${region}

--- ROUND 1: INDEPENDENT ANALYSES ---
${r1Text}

--- ROUND 2: CROSS-EXAMINATIONS ---
${r2Text}

--- ORIGINAL SOURCES ---
${sourceText}${failedModels && failedModels.length > 0 ? `\n\n--- MODELS THAT FAILED ---\n${failedModels.map(f => `${f.model}: ${f.reason} (${f.round})`).join('\n')}\nNote: These models did not participate. Do not assume their agreement with consensus.` : ''}`

  const result = await callModel({
    provider: 'anthropic',
    tier: 'deep',
    system: buildSystemPrompt(region, query),
    userMessage: userPrompt,
    maxTokens: 8192,
    agentType: 'debate_moderator',
    region,
    storyId,
  })

  const output = parseJSON<ModeratorOutput>(result.text)
  output.region = region
  output.models_participating = r1Results.map((r) => r.modelName)

  return {
    output,
    rawText: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  }
}
