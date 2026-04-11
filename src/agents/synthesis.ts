import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'
import { ANTI_HALLUCINATION_RULES, LANGUAGE_RULES, JSON_RULES } from './prompts'
import type { RegionalAnalysis } from '@/agents/regional'
import type { SilenceAnalysis } from '@/agents/silence'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SynthesisResult {
  headline: string
  confidenceLevel: string
  consensusScore: number
  synopsis: string // maps from "summary" in JSON
  thePattern: string
  confidenceNote: string
  claims: Array<{
    claim: string
    confidence: string
    consensusPct: number
    supportedBy: string
    contradictedBy: string
    notes?: string
  }>
  framingSplit: Array<{
    frameName: string
    outletCount: number
    outletTypes: string
    ledWith: string
    omitted: string
    outlets: string
    sortOrder: number
  }>
  omissions: Array<{
    outletRegion: string
    missing: string
    presentIn: string
    significance: string
  }>
  discrepancies: Array<{
    issue: string
    sideA: string
    sideB: string
    sourcesA: string
    sourcesB: string
    assessment: string
  }>
  framings: Array<{
    region: string
    framing: string
    contrastWith: string
  }>
  regionalCoverage: Array<{
    region: string
    sourceCount: number
    coverageLevel: string
  }>
  silenceExplanation: string
  followUpQuestions: Array<{
    question: string
    hypotheses: string[]
    evidenceStatus: string
  }>
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Overcurrent synthesis engine. You receive analyses from up to 6 world regions about a single story and must produce a unified verification report.

Your job:
1. Write a clear, factual HEADLINE for this story.
2. Determine overall CONFIDENCE LEVEL based on cross-regional consensus.
3. Calculate a CONSENSUS SCORE (0-100) representing overall source agreement.
4. Your summary is a CONCLUSION, not a synopsis. Answer "what did we find?" in 2-4 sentences. Write for a smart person in a hurry. Be direct.
5. You MUST include a "the_pattern" field — the single most shareable insight, under 280 characters. This is the one thing someone would screenshot and share as a standalone statement.
6. Merge and deduplicate CLAIMS across regions. For each claim, note which outlets support or contradict it, who the original source was, and whether full text was verified.
7. framing_split is mandatory — show how different outlet groups frame the same story differently. Group outlets by editorial lean or type. For each frame, note what they led with and what they omitted.
8. Identify OMISSIONS — important facts that some outlets reported but others didn't. Note who reported it and who missed it.
9. Highlight the most significant DISCREPANCIES between sources. For each, describe both sides and attempt resolution.
10. Provide regional_coverage — how many sources from each major world region covered this story, and a coverage_level (heavy / moderate / light / minimal / silent).
11. Provide silence_explanation — why silent regions likely didn't cover this.
12. Generate 3-5 FOLLOW-UP QUESTIONS. follow_up_questions must include hypotheses — naked questions are not acceptable. Each question must have at least one hypothesis and an evidence_status.

Be direct, factual, and precise. Don't hedge excessively. State what the evidence shows.

Wire copies from the same original source (AP, Reuters, AFP) count as 1 independent source, not multiple.

If consensus is >90%, include this note in confidence_note: "Near-universal consensus. High agreement sometimes reflects shared assumptions rather than independent verification."

${ANTI_HALLUCINATION_RULES}

${LANGUAGE_RULES}

${JSON_RULES}

Response shape:
{
  "headline": "string",
  "confidence_level": "HIGH | MEDIUM | LOW | DEVELOPING",
  "consensus_score": 0,
  "summary": "2-4 sentence plain English CONCLUSION. Not a synopsis. THE ANSWER to 'what did we find?' Written for a smart person in a hurry.",
  "the_pattern": "1-2 sentence shareable insight under 280 chars",
  "confidence_note": "string",
  "claims": [
    {
      "claim": "string",
      "confidence": "HIGH | MEDIUM | LOW",
      "supported_by": "outlet names comma separated",
      "contradicted_by": "outlet names or empty",
      "original_source": "who broke it",
      "full_text_verified": true,
      "sort_order": 1
    }
  ],
  "framing_split": [
    {
      "frame_name": "string",
      "outlet_count": 0,
      "outlet_types": "string",
      "led_with": "string",
      "omitted": "string",
      "outlets": "string",
      "sort_order": 1
    }
  ],
  "omissions": [
    {
      "what_missing": "string",
      "reported_by": "outlet names",
      "missing_from": "string",
      "significance": "string",
      "sort_order": 1
    }
  ],
  "discrepancies": [
    {
      "issue": "string",
      "side_a": "string",
      "side_b": "string",
      "sources_a": "string",
      "sources_b": "string",
      "resolution": "string",
      "sort_order": 1
    }
  ],
  "regional_coverage": [
    { "region": "string", "source_count": 0, "coverage_level": "heavy | moderate | light | minimal | silent" }
  ],
  "silence_explanation": "string",
  "follow_up_questions": [
    {
      "question": "string",
      "hypotheses": ["string"],
      "evidence_status": "string"
    }
  ]
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
    maxTokens: 8192,
    storyId,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJSON<any>(text)

  // ---------------------------------------------------------------------------
  // Map snake_case AI output → camelCase, with safe defaults & backward compat
  // ---------------------------------------------------------------------------

  const headline: string = parsed.headline ?? ''
  const confidenceLevel: string =
    parsed.confidence_level ?? parsed.confidenceLevel ?? 'DEVELOPING'
  const consensusScore: number =
    parsed.consensus_score ?? parsed.consensusScore ?? 0
  const synopsis: string =
    parsed.summary ?? parsed.synopsis ?? ''
  const thePattern: string =
    parsed.the_pattern ?? parsed.thePattern ?? ''
  const confidenceNote: string =
    parsed.confidence_note ?? parsed.confidenceNote ?? ''
  const silenceExplanation: string =
    parsed.silence_explanation ?? parsed.silenceExplanation ?? ''

  // --- claims ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claims = (parsed.claims ?? []).map((c: any) => ({
    claim: String(c.claim ?? ''),
    confidence: String(c.confidence ?? 'LOW'),
    consensusPct: Number(c.consensus_pct ?? c.consensusPct ?? 0),
    supportedBy: String(c.supported_by ?? c.supportedBy ?? ''),
    contradictedBy: String(c.contradicted_by ?? c.contradictedBy ?? ''),
    notes: c.notes != null ? String(c.notes) : undefined,
  }))

  // --- framing_split (new) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawFramingSplit = parsed.framing_split ?? parsed.framingSplit ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const framingSplit = rawFramingSplit.map((f: any) => ({
    frameName: String(f.frame_name ?? f.frameName ?? ''),
    outletCount: Number(f.outlet_count ?? f.outletCount ?? 0),
    outletTypes: String(f.outlet_types ?? f.outletTypes ?? ''),
    ledWith: String(f.led_with ?? f.ledWith ?? ''),
    omitted: String(f.omitted ?? ''),
    outlets: String(f.outlets ?? ''),
    sortOrder: Number(f.sort_order ?? f.sortOrder ?? 0),
  }))

  // --- omissions ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const omissions = (parsed.omissions ?? []).map((o: any) => ({
    outletRegion: String(
      o.outlet_region ?? o.outletRegion ?? o.missing_from ?? '',
    ),
    missing: String(o.what_missing ?? o.missing ?? ''),
    presentIn: String(o.reported_by ?? o.presentIn ?? ''),
    significance: String(o.significance ?? ''),
  }))

  // --- discrepancies ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const discrepancies = (parsed.discrepancies ?? []).map((d: any) => ({
    issue: String(d.issue ?? ''),
    sideA: String(d.side_a ?? d.sideA ?? ''),
    sideB: String(d.side_b ?? d.sideB ?? ''),
    sourcesA: String(d.sources_a ?? d.sourcesA ?? ''),
    sourcesB: String(d.sources_b ?? d.sourcesB ?? ''),
    assessment: String(d.resolution ?? d.assessment ?? ''),
  }))

  // --- framings (backward compat) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const framings = (parsed.framings ?? []).map((f: any) => ({
    region: String(f.region ?? ''),
    framing: String(f.framing ?? ''),
    contrastWith: String(f.contrastWith ?? f.contrast_with ?? ''),
  }))

  // --- regional_coverage (new) ---
  const rawRegionalCoverage =
    parsed.regional_coverage ?? parsed.regionalCoverage ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regionalCoverage = rawRegionalCoverage.map((r: any) => ({
    region: String(r.region ?? ''),
    sourceCount: Number(r.source_count ?? r.sourceCount ?? 0),
    coverageLevel: String(r.coverage_level ?? r.coverageLevel ?? 'silent'),
  }))

  // --- follow_up_questions (updated: now objects with hypotheses) ---
  const rawFuq =
    parsed.follow_up_questions ?? parsed.followUpQuestions ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const followUpQuestions = rawFuq.map((q: any) => {
    // Backward compat: old format was plain strings
    if (typeof q === 'string') {
      return { question: q, hypotheses: [], evidenceStatus: '' }
    }
    return {
      question: String(q.question ?? ''),
      hypotheses: Array.isArray(q.hypotheses)
        ? q.hypotheses.map(String)
        : [],
      evidenceStatus: String(
        q.evidence_status ?? q.evidenceStatus ?? '',
      ),
    }
  })

  return {
    headline,
    confidenceLevel,
    consensusScore,
    synopsis,
    thePattern,
    confidenceNote,
    claims,
    framingSplit,
    omissions,
    discrepancies,
    framings,
    regionalCoverage,
    silenceExplanation,
    followUpQuestions,
    costUsd,
  }
}
