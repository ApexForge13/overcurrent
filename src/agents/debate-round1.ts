import { callModel, parseJSON } from '@/lib/models'
import type { DebateModel } from '@/lib/debate-config'
import { ANTI_HALLUCINATION_RULES, JSON_RULES } from './prompts'

export interface Round1KeyFact {
  fact: string
  reported_by: string[]
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  sourcing_type: string
  based_on_full_text: boolean
}

export interface Round1ContestedClaim {
  claim: string
  reported_by: string[]
  not_confirmed_by: string[]
  lean_correlation: string
  original_source: string
}

export interface Round1Analysis {
  model_name: string
  region: string
  source_count: number
  key_facts: Round1KeyFact[]
  contested_claims: Round1ContestedClaim[]
  dominant_framing: string
  political_lean_split: {
    left_emphasis: string
    right_emphasis: string
    center_consensus: string
  }
  source_quality_assessment: string
  unique_information: string
  state_media_divergence: string
  omissions_detected: string[]
  confidence_in_own_analysis: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface Round1Result {
  analysis: Round1Analysis
  rawText: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  modelName: string
  provider: string
}

function buildSystemPrompt(region: string, query: string): string {
  return `You are an independent news coverage analyst for Overcurrent. You are one of 4 AI models analyzing the same set of sources. Your analysis will be reviewed and challenged by the other 3 models, so be rigorous and precise. Every claim must reference specific outlets by name.

You are analyzing coverage from the ${region} region on the topic: "${query}"

${ANTI_HALLUCINATION_RULES}

Analyze the provided sources and produce:

${JSON_RULES}

{
  "model_name": "your model name",
  "region": "${region}",
  "source_count": 0,
  "key_facts": [
    {
      "fact": "Specific factual claim",
      "reported_by": ["Outlet Name 1", "Outlet Name 2"],
      "confidence": "HIGH | MEDIUM | LOW",
      "sourcing_type": "named official | anonymous | documents | wire service | social media",
      "based_on_full_text": true
    }
  ],
  "contested_claims": [
    {
      "claim": "The specific contested claim",
      "reported_by": ["outlets supporting"],
      "not_confirmed_by": ["outlets that cover the story but don't include this"],
      "lean_correlation": "Does this claim appear only from one political lean?",
      "original_source": "Who originally reported this? Is everyone citing the same source?"
    }
  ],
  "dominant_framing": "2-3 sentences on how this region frames the story",
  "political_lean_split": {
    "left_emphasis": "What left-leaning outlets emphasize",
    "right_emphasis": "What right-leaning outlets emphasize",
    "center_consensus": "Where centrist outlets converge"
  },
  "source_quality_assessment": "How reliable is the sourcing in this region's coverage?",
  "unique_information": "Anything only this region's outlets report that others likely won't have",
  "state_media_divergence": "Where state media diverges from independent outlets (or N/A)",
  "omissions_detected": ["Things you'd expect to see covered but aren't in these sources"],
  "confidence_in_own_analysis": "HIGH | MEDIUM | LOW"
}`
}

export async function runRound1(
  model: DebateModel,
  region: string,
  sources: Array<{ url: string; title: string; outlet: string; content?: string }>,
  query: string,
  storyId?: string,
): Promise<Round1Result> {
  const sourceText = sources
    .map((s, i) => {
      const contentLen = s.content?.length || 0
      const quality = contentLen >= 200 ? 'FULL' : contentLen >= 50 ? 'PARTIAL' : contentLen > 0 ? 'SNIPPET' : 'NO_CONTENT'
      const qualityNote = quality === 'SNIPPET' ? ` (${contentLen} chars — headline only, treat with caution)` :
        quality === 'NO_CONTENT' ? ' (no article text available — headline only)' :
        quality === 'PARTIAL' ? ` (${contentLen} chars — partial text)` : ''
      return `[${i + 1}] ${s.outlet}: "${s.title}"\nFetch quality: ${quality}${qualityNote}\nURL: ${s.url}${s.content ? `\nContent: ${s.content.substring(0, 2000)}` : ''}`
    })
    .join('\n\n')

  const userPrompt = `Analyze these ${sources.length} sources from ${region}:\n\n${sourceText}`

  const result = await callModel({
    provider: model.provider,
    tier: 'deep',
    system: buildSystemPrompt(region, query),
    userMessage: userPrompt,
    maxTokens: 4096,
    agentType: 'debate_r1',
    region,
    storyId,
  })

  const analysis = parseJSON<Round1Analysis>(result.text)
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
