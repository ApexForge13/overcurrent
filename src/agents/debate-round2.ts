import { callModel, parseJSON } from '@/lib/models'
import type { DebateModel } from '@/lib/debate-config'
import { ANTI_HALLUCINATION_RULES, JSON_RULES } from './prompts'
import type { Round1Analysis } from './debate-round1'

export interface Round2Confirmation {
  other_model: string
  claim: string
  your_evidence: string
}

export interface Round2Challenge {
  other_model: string
  their_claim: string
  your_challenge: string
  evidence: string
}

export interface Round2Correction {
  other_model: string
  issue: string
  correction: string
}

export interface Round2Addition {
  finding: string
  evidence: string
  why_missed: string
}

export interface Round2Concession {
  your_original_claim: string
  why_wrong: string
  revised_position: string
}

export interface Round2ProvenanceFlag {
  other_model: string
  issue: string
  actual_independent_sources: number
}

export interface Round2Analysis {
  model_name: string
  region: string
  confirmations: Round2Confirmation[]
  challenges: Round2Challenge[]
  corrections: Round2Correction[]
  additions: Round2Addition[]
  concessions: Round2Concession[]
  provenance_flags: Round2ProvenanceFlag[]
}

export interface Round2Result {
  analysis: Round2Analysis
  rawText: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  modelName: string
  provider: string
}

function buildSystemPrompt(region: string, query: string): string {
  return `You are participating in Round 2 of an Overcurrent analysis debate. In Round 1, you and 3 other AI models independently analyzed the same news sources from ${region}. Now you will review each other's work.

YOUR Round 1 analysis is labeled "YOUR_ANALYSIS" below.
The other models' analyses are labeled by their model names.
The original sources are provided for you to re-check claims.

Your job in Round 2:

1. CONFIRM: Which findings from other models do you agree with? Be specific.
2. CHALLENGE: Which claims from other models are NOT supported by the sources? Call them out with evidence. Cite the specific outlet and what it actually says vs. what the model claimed.
3. CORRECT: Did another model mischaracterize an outlet's position, overweight a source, or assign too-high confidence? Explain why.
4. ADD: Did other models miss something in the sources that you also missed in Round 1? Now that you're looking again with fresh eyes and their analyses as prompts, do you see anything new?
5. CONCEDE: Were any of your OWN Round 1 claims wrong or overconfident after seeing the other models' perspectives? Be honest. Intellectual honesty builds trust.
6. FLAG PROVENANCE: Did any model count wire copies as independent sources? Did any model treat 10 outlets citing the same article as 10 independent confirmations?

Be direct. Be specific. Name the model you're responding to and the exact claim. This is a professional debate, not a polite agreement session.

${ANTI_HALLUCINATION_RULES}

${JSON_RULES}

{
  "model_name": "your model name",
  "region": "${region}",
  "confirmations": [{ "other_model": "name", "claim": "the claim", "your_evidence": "why you agree" }],
  "challenges": [{ "other_model": "name", "their_claim": "what they said", "your_challenge": "why wrong", "evidence": "cite sources" }],
  "corrections": [{ "other_model": "name", "issue": "what they got wrong", "correction": "what sources actually say" }],
  "additions": [{ "finding": "something missed", "evidence": "which sources", "why_missed": "why overlooked" }],
  "concessions": [{ "your_original_claim": "what you said in R1", "why_wrong": "why wrong now", "revised_position": "updated view" }],
  "provenance_flags": [{ "other_model": "name", "issue": "e.g. counted wire copies as independent", "actual_independent_sources": 0 }]
}`
}

export async function runRound2(
  model: DebateModel,
  region: string,
  ownR1: Round1Analysis,
  otherR1s: Array<{ modelName: string; analysis: Round1Analysis }>,
  sources: Array<{ url: string; title: string; outlet: string; content?: string }>,
  query: string,
  storyId?: string,
): Promise<Round2Result> {
  const sourceText = sources
    .map((s, i) => `[${i + 1}] ${s.outlet}: "${s.title}"\nURL: ${s.url}${s.content ? `\nContent: ${s.content.substring(0, 1500)}` : ''}`)
    .join('\n\n')

  const otherAnalysesText = otherR1s
    .map((o) => `=== ${o.modelName}'s Round 1 Analysis ===\n${JSON.stringify(o.analysis, null, 2)}`)
    .join('\n\n')

  const userPrompt = `Topic: "${query}" | Region: ${region}

=== YOUR_ANALYSIS (${model.name}'s Round 1) ===
${JSON.stringify(ownR1, null, 2)}

${otherAnalysesText}

=== ORIGINAL SOURCES (for re-checking claims) ===
${sourceText}`

  const result = await callModel({
    provider: model.provider,
    tier: 'deep',
    system: buildSystemPrompt(region, query),
    userMessage: userPrompt,
    maxTokens: 12288,
    agentType: 'debate_r2',
    region,
    storyId,
  })

  let analysis: Round2Analysis
  try {
    analysis = parseJSON<Round2Analysis>(result.text)
  } catch (err) {
    // Check if truncated (doesn't end with })
    const trimmed = result.text.trim()
    if (trimmed.length > 100 && !trimmed.endsWith('}')) {
      console.warn(`[Debate R2] ${model.name} output truncated for ${region} — attempting salvage`)
      // Try to close unclosed JSON structures
      let salvage = trimmed
      let braces = 0, brackets = 0
      for (const c of salvage) {
        if (c === '{') braces++; if (c === '}') braces--
        if (c === '[') brackets++; if (c === ']') brackets--
      }
      while (brackets > 0) { salvage += ']'; brackets-- }
      while (braces > 0) { salvage += '}'; braces-- }
      try {
        analysis = parseJSON<Round2Analysis>(salvage)
        console.log(`[Debate R2] Salvaged truncated ${model.name} output for ${region}`)
      } catch {
        console.warn(`[Debate R2] ${model.name} salvage failed for ${region}. Raw:`, result.text.substring(0, 300))
        analysis = {
          model_name: model.name, region,
          confirmations: [], challenges: [], corrections: [],
          additions: [], concessions: [], provenance_flags: [],
        }
      }
    } else {
      console.warn(`[Debate R2] ${model.name} parse failed for ${region}. Raw:`, result.text.substring(0, 300))
      analysis = {
        model_name: model.name, region,
        confirmations: [], challenges: [], corrections: [],
        additions: [], concessions: [], provenance_flags: [],
      }
    }
  }
  analysis.model_name = model.name
  analysis.region = region

  return {
    analysis,
    rawText: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    modelName: model.name,
    provider: model.provider,
  }
}
