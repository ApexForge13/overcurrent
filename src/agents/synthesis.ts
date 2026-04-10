import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'
import type { RegionalAnalysis } from '@/agents/regional'
import type { SilenceAnalysis } from '@/agents/silence'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SynthesisResult {
  headline: string
  synopsis: string
  confidenceLevel: 'verified' | 'mostly_verified' | 'mixed' | 'disputed' | 'unverified'
  confidenceNote: string
  claims: Array<{
    claim: string
    confidence: string
    consensusPct: number
    supportedBy: string
    contradictedBy: string
    notes?: string
  }>
  discrepancies: Array<{
    issue: string
    sideA: string
    sideB: string
    sourcesA: string
    sourcesB: string
    assessment: string
  }>
  omissions: Array<{
    outletRegion: string
    missing: string
    presentIn: string
    significance: string
  }>
  framings: Array<{
    region: string
    framing: string
    contrastWith: string
  }>
  followUpQuestions: string[]
  consensusScore: number
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Overcurrent synthesis engine. You receive analyses from up to 6 world regions about a single story and must produce a unified verification report.

Your job:
1. Write a clear, factual HEADLINE for this story.
2. Write a 3-5 paragraph SYNOPSIS that synthesizes all regional perspectives. This should read like a well-sourced news briefing. Cite specific outlets and regions. Use markdown formatting.
3. Determine overall CONFIDENCE LEVEL based on cross-regional consensus.
4. Merge and deduplicate CLAIMS across regions. For each claim, calculate what percentage of regions/sources support it (consensusPct).
5. Highlight the most significant DISCREPANCIES between regions.
6. Identify OMISSIONS — important facts that some regions reported but others didn't.
7. Contrast regional FRAMINGS — how the same story is told differently.
8. Generate 3-5 FOLLOW-UP QUESTIONS that a thorough reader should investigate.
9. Calculate a CONSENSUS SCORE (0-100) representing overall source agreement.

Be direct, factual, and precise. Don't hedge excessively. State what the evidence shows.

Respond with JSON only. No markdown fences.

Response shape:
{
  "headline": "string",
  "synopsis": "string (markdown)",
  "confidenceLevel": "verified | mostly_verified | mixed | disputed | unverified",
  "confidenceNote": "string",
  "claims": [
    {
      "claim": "string",
      "confidence": "string",
      "consensusPct": 0,
      "supportedBy": "string",
      "contradictedBy": "string",
      "notes": "optional string"
    }
  ],
  "discrepancies": [
    {
      "issue": "string",
      "sideA": "string",
      "sideB": "string",
      "sourcesA": "string",
      "sourcesB": "string",
      "assessment": "string"
    }
  ],
  "omissions": [
    {
      "outletRegion": "string",
      "missing": "string",
      "presentIn": "string",
      "significance": "string"
    }
  ],
  "framings": [
    {
      "region": "string",
      "framing": "string",
      "contrastWith": "string"
    }
  ],
  "followUpQuestions": ["string"],
  "consensusScore": 0
}`

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function synthesize(
  query: string,
  regionalAnalyses: RegionalAnalysis[],
  silenceAnalyses: SilenceAnalysis[],
  sourceCount: number,
  countryCount: number,
  regionCount: number,
  storyId?: string,
): Promise<SynthesisResult> {
  const userPrompt = `Topic: ${query}

Coverage scope: ${sourceCount} sources, ${countryCount} countries, ${regionCount} regions

Regional analyses:
${JSON.stringify(
  regionalAnalyses.map((r) => ({
    region: r.region,
    claims: r.claims,
    discrepancies: r.discrepancies,
    framingAnalysis: r.framingAnalysis,
    omissions: r.omissions,
  })),
  null,
  2,
)}

Regions with zero coverage:
${JSON.stringify(
  silenceAnalyses.map((s) => ({
    region: s.region,
    possibleReasons: s.possibleReasons,
    isSignificant: s.isSignificant,
  })),
  null,
  2,
)}`

  const { text, costUsd } = await callClaude({
    model: SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'synthesis',
    storyId,
  })

  const parsed = parseJSON<Omit<SynthesisResult, 'costUsd'>>(text)

  return {
    headline: parsed.headline ?? '',
    synopsis: parsed.synopsis ?? '',
    confidenceLevel: parsed.confidenceLevel ?? 'unverified',
    confidenceNote: parsed.confidenceNote ?? '',
    claims: parsed.claims ?? [],
    discrepancies: parsed.discrepancies ?? [],
    omissions: parsed.omissions ?? [],
    framings: parsed.framings ?? [],
    followUpQuestions: parsed.followUpQuestions ?? [],
    consensusScore: parsed.consensusScore ?? 0,
    costUsd,
  }
}
