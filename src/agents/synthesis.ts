import { callClaude, parseJSON, OPUS } from '@/lib/anthropic'
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
  propagationTimeline: Array<{
    hour: number
    timestamp?: string
    label: string
    description: string
    regions: Array<{
      region_id: string
      status: string
      coverage_volume: number
      dominant_quote: string
      outlet_count: number
      key_outlets: string[]
    }>
    flows: Array<{
      from: string
      to: string
      type: string
    }>
  }>
  buriedEvidence: Array<{
    fact: string
    reportedBy: string
    contradicts: string
    notPickedUpBy: string[]
    sourceType: string
    whyItMatters: string
    sortOrder: number
  }>
  factSurvival: Array<{
    fact: string
    originLayer: string
    survivedTo: string
    diedAt: string
    killPoint: string
    whatWasLost: string
    significance: string
    sortOrder: number
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

CRITICAL SOURCE VERIFICATION RULE:
Before writing ANY claim about a country or region having "zero coverage," "complete absence," "silence," or "no coverage found," CHECK THE SOURCE LIST YOU RECEIVED. If outlets from that country/region are present in your regional analyses, do NOT claim they are absent. Describe their actual contribution instead — thin coverage is different from no coverage. Getting this wrong destroys credibility.

${LANGUAGE_RULES}

${JSON_RULES}

BURIED EVIDENCE DETECTION:

After analyzing claims across all sources, actively hunt for "buried evidence" — facts that were REPORTED by real outlets but died before reaching wider coverage. These are NOT omissions (facts nobody covered). These are facts that WERE reported, with real sources, by real journalists — and then were not picked up by other outlets.

A fact qualifies as buried evidence when ALL of these are true:
1. It appears in 1-2 outlets only
2. It directly complicates or contradicts a claim that appears in 10+ outlets
3. It contains an on-record source (named person, official document, verified data)
4. It was published by a credible outlet (not a blog or social post)

For each buried evidence item, note:
- The specific fact/quote
- Who reported it (outlet name)
- What it contradicts or complicates in the dominant narrative
- Which outlets covered the story but did NOT pick up this fact
- Why it matters (how the narrative changes if you include this fact)

FACT SURVIVAL TRACKING:

For the most important 3-5 facts in this story, trace their survival through editorial layers:

Layer 1: "on_scene" — eyewitness, official statement, primary document
Layer 2: "local" — local TV, local newspaper, local digital
Layer 3: "national" — national TV, national newspaper, wire services
Layer 4: "international" — foreign outlets covering the story

For each fact, note:
- Which layer it originated at (origin_layer)
- Which layer it survived to (survived_to)
- Where it DIED — which boundary filtered it out (died_at, or "survived_all" if it made it everywhere)
- The specific editorial boundary where it was lost (kill_point, e.g. "CBS LA → national outlets")
- What was lost when it died (what_was_lost)
- Significance: HIGH (changes the narrative), MEDIUM (adds nuance), LOW (routine filtering)

Not all fact deaths are significant — routine details naturally get filtered. Only flag facts whose death changes how the story reads.

If a fact survived all layers, still include it with died_at: "survived_all" — surviving is data too.

PROPAGATION TIMELINE:

You MAY receive a pre-computed propagation timeline based on real article publication timestamps. If provided, your job is to ENRICH each time bucket with:
- status per region (original | wire_copy | reframed | contradicted | silent)
- coverage_volume (0-100)
- dominant_quote (~10 words of how they frame it at this point)
- description of what's happening at this point in the story's propagation
- flows between regions (wire_copy | reframed | contradicted)

CRITICAL: Do NOT change the timestamps, labels, or hoursSinceFirst values — they are computed from real publication data.
Use the provided region_ids and outlet information as your foundation.
If a region appears in a later bucket but not an earlier one, mark it as "silent" in earlier buckets.
Copy the "label" field directly from the pre-computed data.
Set "hour" to the hoursSinceFirst value from each bucket.

If NO pre-computed timeline is provided, create a best-estimate timeline with 5-8 steps spanning the story's likely duration. Use these region IDs: us, ca, mx, la, uk, eu, ru, tr, me, ir, il, af, in, cn, jp, kr, sea, au, pk

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
  ],
  "buried_evidence": [
    {
      "fact": "Dock worker Alejandro Montero told CBS Los Angeles he was 'making good money' at the same facility",
      "reported_by": "CBS Los Angeles",
      "contradicts": "The dominant narrative that workers were underpaid, which appears in 40+ outlets",
      "not_picked_up_by": ["Fox News", "NBC News", "ABC News", "Daily Wire", "Bloomberg"],
      "source_type": "named on-record source",
      "why_it_matters": "Without this quote, the suspect's wage complaint goes completely unchallenged in national coverage",
      "sort_order": 1
    }
  ],
  "fact_survival": [
    {
      "fact": "Coworker said 'I was making good money'",
      "origin_layer": "local",
      "survived_to": "local",
      "died_at": "national",
      "kill_point": "CBS LA → national outlets",
      "what_was_lost": "The only on-record counter-narrative to wage claims",
      "significance": "HIGH",
      "sort_order": 1
    }
  ],
  "propagation_timeline": [
    {
      "hour": 0,
      "label": "+0 hrs",
      "description": "Story breaks",
      "regions": [
        { "region_id": "us", "status": "original", "coverage_volume": 10, "dominant_quote": "...", "outlet_count": 2, "key_outlets": ["..."] }
      ],
      "flows": []
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
  preComputedTimeline?: Array<{
    timestamp: string
    label: string
    hoursSinceFirst: number
    regions: Array<{ region_id: string; outlet_count: number; key_outlets: string[]; country: string }>
  }>,
  storyId?: string,
): Promise<SynthesisResult> {
  const timelineSection = preComputedTimeline && preComputedTimeline.length > 0
    ? `\n\nPre-computed propagation timeline (based on real publication timestamps — use these exact time buckets, do NOT invent new ones):\n${JSON.stringify(preComputedTimeline, null, 2)}`
    : ''

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
)}${timelineSection}`

  const { text, costUsd } = await callClaude({
    model: OPUS,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'synthesis',
    maxTokens: 32768,
    storyId,
  })

  // Try to parse JSON — if truncated, attempt repair by closing brackets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any
  try {
    parsed = parseJSON<any>(text)
  } catch (firstErr) {
    console.warn('[Synthesis] JSON parse failed, attempting repair...')
    // Common issue: output truncated mid-JSON. Try closing open brackets.
    let repaired = text.trim()
    // Strip any trailing partial string
    const lastCompleteField = repaired.lastIndexOf('",')
    if (lastCompleteField > repaired.length * 0.7) {
      repaired = repaired.substring(0, lastCompleteField + 1)
    }
    // Count open/close brackets and close any unclosed ones
    const opens = (repaired.match(/\[/g) || []).length
    const closes = (repaired.match(/\]/g) || []).length
    const openBraces = (repaired.match(/\{/g) || []).length
    const closeBraces = (repaired.match(/\}/g) || []).length
    repaired += ']'.repeat(Math.max(0, opens - closes))
    repaired += '}'.repeat(Math.max(0, openBraces - closeBraces))
    try {
      parsed = parseJSON<any>(repaired)
      console.log('[Synthesis] JSON repair succeeded')
    } catch {
      console.error('[Synthesis] JSON repair failed. Raw text length:', text.length)
      throw firstErr
    }
  }

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

  // --- buried_evidence ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buriedEvidence = (parsed.buried_evidence ?? parsed.buriedEvidence ?? []).map((b: any, i: number) => ({
    fact: String(b.fact ?? ''),
    reportedBy: String(b.reported_by ?? b.reportedBy ?? ''),
    contradicts: String(b.contradicts ?? ''),
    notPickedUpBy: Array.isArray(b.not_picked_up_by ?? b.notPickedUpBy)
      ? (b.not_picked_up_by ?? b.notPickedUpBy).map(String) : [],
    sourceType: String(b.source_type ?? b.sourceType ?? ''),
    whyItMatters: String(b.why_it_matters ?? b.whyItMatters ?? ''),
    sortOrder: Number(b.sort_order ?? b.sortOrder ?? i),
  }))

  // --- fact_survival ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factSurvival = (parsed.fact_survival ?? parsed.factSurvival ?? []).map((f: any, i: number) => ({
    fact: String(f.fact ?? ''),
    originLayer: String(f.origin_layer ?? f.originLayer ?? ''),
    survivedTo: String(f.survived_to ?? f.survivedTo ?? ''),
    diedAt: String(f.died_at ?? f.diedAt ?? ''),
    killPoint: String(f.kill_point ?? f.killPoint ?? ''),
    whatWasLost: String(f.what_was_lost ?? f.whatWasLost ?? ''),
    significance: String(f.significance ?? 'MEDIUM'),
    sortOrder: Number(f.sort_order ?? f.sortOrder ?? i),
  }))

  // --- propagation_timeline ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const propagationTimeline = (parsed.propagation_timeline ?? parsed.propagationTimeline ?? []).map((frame: any) => ({
    hour: Number(frame.hour ?? frame.hoursSinceFirst ?? 0),
    timestamp: frame.timestamp ? String(frame.timestamp) : undefined,
    label: String(frame.label ?? ''),
    description: String(frame.description ?? ''),
    regions: (frame.regions ?? []).map((r: any) => ({
      region_id: String(r.region_id ?? ''),
      status: String(r.status ?? 'silent'),
      coverage_volume: Number(r.coverage_volume ?? 0),
      dominant_quote: String(r.dominant_quote ?? ''),
      outlet_count: Number(r.outlet_count ?? 0),
      key_outlets: Array.isArray(r.key_outlets) ? r.key_outlets.map(String) : [],
    })),
    flows: (frame.flows ?? []).map((f: any) => ({
      from: String(f.from ?? ''),
      to: String(f.to ?? ''),
      type: String(f.type ?? 'wire_copy'),
    })),
  }))

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
    propagationTimeline,
    buriedEvidence,
    factSurvival,
    costUsd,
  }
}
