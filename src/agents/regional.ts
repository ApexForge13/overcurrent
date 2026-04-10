import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegionalAnalysis {
  region: string
  claims: Array<{
    claim: string
    confidence: 'confirmed' | 'likely' | 'disputed' | 'unverified'
    supportedBy: string[]
    contradictedBy: string[]
    notes?: string
  }>
  discrepancies: Array<{
    issue: string
    sideA: string
    sideB: string
    sourcesA: string[]
    sourcesB: string[]
    assessment?: string
  }>
  framingAnalysis: {
    framing: string
    notableAngles: string[]
  }
  omissions: Array<{
    missing: string
    presentIn: string
    significance: string
  }>
  sourceSummaries: Array<{
    url: string
    summary: string
  }>
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(region: string): string {
  return `You are an Overcurrent regional analysis agent for the ${region} region. You analyze news sources from this region about a specific story.

Given articles from ${region} about the topic, you must:
1. Extract specific factual CLAIMS from these sources. For each claim, rate confidence and note which sources support or contradict it.
2. Identify DISCREPANCIES between sources — where do they disagree on facts, figures, timelines, or attributions?
3. Analyze FRAMING — how is this region covering the story? What angles are emphasized? What language patterns are used?
4. Identify OMISSIONS — what information available from other regions is MISSING from this region's coverage?
5. Provide a brief summary of each source's key points.

Be precise. Cite specific outlets. Do not speculate beyond what the sources say.

Respond with JSON only. No markdown fences.

Response shape:
{
  "region": "string",
  "claims": [
    {
      "claim": "string",
      "confidence": "confirmed | likely | disputed | unverified",
      "supportedBy": ["outlet names"],
      "contradictedBy": ["outlet names"],
      "notes": "optional string"
    }
  ],
  "discrepancies": [
    {
      "issue": "string",
      "sideA": "string",
      "sideB": "string",
      "sourcesA": ["outlet names"],
      "sourcesB": ["outlet names"],
      "assessment": "optional string"
    }
  ],
  "framingAnalysis": {
    "framing": "string",
    "notableAngles": ["string"]
  },
  "omissions": [
    {
      "missing": "string",
      "presentIn": "string",
      "significance": "string"
    }
  ],
  "sourceSummaries": [
    {
      "url": "string",
      "summary": "string"
    }
  ]
}`
}

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function analyzeRegion(
  region: string,
  sources: Array<{ url: string; title: string; outlet: string; content?: string }>,
  query: string,
  allRegionsSummary: string,
  storyId?: string,
): Promise<RegionalAnalysis> {
  const userPrompt = `Topic: ${query}

Context from other regions (for omission detection):
${allRegionsSummary}

Sources from ${region} (${sources.length} articles):
${JSON.stringify(
  sources.map((s) => ({
    url: s.url,
    title: s.title,
    outlet: s.outlet,
    content: s.content ?? '(content not available)',
  })),
  null,
  2,
)}`

  const { text, costUsd } = await callClaude({
    model: SONNET,
    systemPrompt: buildSystemPrompt(region),
    userPrompt,
    agentType: 'regional',
    region,
    storyId,
  })

  const parsed = parseJSON<Omit<RegionalAnalysis, 'costUsd'>>(text)

  return {
    region: parsed.region ?? region,
    claims: parsed.claims ?? [],
    discrepancies: parsed.discrepancies ?? [],
    framingAnalysis: parsed.framingAnalysis ?? { framing: '', notableAngles: [] },
    omissions: parsed.omissions ?? [],
    sourceSummaries: parsed.sourceSummaries ?? [],
    costUsd,
  }
}
