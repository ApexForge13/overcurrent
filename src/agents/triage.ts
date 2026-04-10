import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriagedSource {
  url: string
  title: string
  outlet: string
  outletType: string
  country: string
  region: string
  language: string
  politicalLean: string
  reliability: string
}

export interface TriageResult {
  sources: TriagedSource[]
  suggestedCategory: string
  searchQueryRefinement: string
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a news source triage agent. Given a list of raw article results about a topic, your job is:
1. Remove duplicate URLs and near-duplicate articles (same story, same outlet)
2. Identify each source's outlet name, type (wire/newspaper/broadcaster/digital/state), country, region, political lean, and reliability
3. Filter out irrelevant results that don't actually relate to the query
4. Suggest a category for this story (politics, conflict, economy, technology, health, environment, society, other)
5. Suggest a refined search query if the original seems too broad or too narrow

Use the 6 regions: North America, Europe, Asia-Pacific, Middle East & Africa, Latin America, South & Central Asia.

Respond with JSON only. No markdown fences.

Response shape:
{
  "sources": [
    {
      "url": "string",
      "title": "string",
      "outlet": "string",
      "outletType": "wire | newspaper | broadcaster | digital | state",
      "country": "string",
      "region": "string",
      "language": "string",
      "politicalLean": "string",
      "reliability": "string"
    }
  ],
  "suggestedCategory": "string",
  "searchQueryRefinement": "string"
}`

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function triageSources(
  rawSources: Array<{ url: string; title: string; domain: string; sourcecountry: string }>,
  query: string,
  storyId?: string,
): Promise<TriageResult> {
  const truncated = rawSources.slice(0, 100)

  const userPrompt = `Query: ${query}

Raw sources (${truncated.length} of ${rawSources.length} total):
${JSON.stringify(truncated, null, 2)}`

  const { text, costUsd } = await callClaude({
    model: HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'triage',
    storyId,
  })

  const parsed = parseJSON<Omit<TriageResult, 'costUsd'>>(text)

  return {
    sources: parsed.sources ?? [],
    suggestedCategory: parsed.suggestedCategory ?? 'other',
    searchQueryRefinement: parsed.searchQueryRefinement ?? query,
    costUsd,
  }
}
