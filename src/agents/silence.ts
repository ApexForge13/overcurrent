import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SilenceAnalysis {
  region: string
  sourcesSearched: number
  possibleReasons: string
  isSignificant: boolean
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(region: string): string {
  return `You are an Overcurrent silence detection agent. A story has been searched across ${region} but ZERO sources were found. Analyze why.

Consider:
1. Is this topic simply not relevant to this region? (A local US zoning dispute wouldn't be covered in Asia)
2. Is there potential media suppression or censorship? (Some regions have state-controlled media)
3. Is it a language barrier or search limitation? (Story might be covered in local language)
4. Is the silence SIGNIFICANT? A major global event with zero coverage in a region is notable. A local story with no coverage elsewhere is expected.

Be balanced and precise. Don't assume censorship when irrelevance is more likely.

Respond with JSON only. No markdown fences.

Response shape:
{
  "region": "string",
  "sourcesSearched": 0,
  "possibleReasons": "string",
  "isSignificant": true | false
}`
}

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function analyzeSilence(
  region: string,
  query: string,
  sourcesSearched: number,
  otherRegionsSummary: string,
  storyId?: string,
): Promise<SilenceAnalysis> {
  const userPrompt = `Topic: ${query}

Region with zero coverage: ${region}
Number of sources searched: ${sourcesSearched}

Summary of coverage from other regions:
${otherRegionsSummary}`

  const { text, costUsd } = await callClaude({
    model: SONNET,
    systemPrompt: buildSystemPrompt(region),
    userPrompt,
    agentType: 'silence',
    region,
    storyId,
  })

  const parsed = parseJSON<Omit<SilenceAnalysis, 'costUsd'>>(text)

  return {
    region: parsed.region ?? region,
    sourcesSearched: parsed.sourcesSearched ?? sourcesSearched,
    possibleReasons: parsed.possibleReasons ?? '',
    isSignificant: parsed.isSignificant ?? false,
    costUsd,
  }
}
