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

IMPORTANT RULES:
- Keep at LEAST 20-30 unique sources. Do NOT over-filter.
- Maximize regional diversity — keep sources from as many different regions as possible.
- region MUST be exactly one of these 6 values: "North America", "Europe", "Asia-Pacific", "Middle East & Africa", "Latin America", "South & Central Asia"
- Do NOT invent other region names. Use ONLY the 6 listed above.
- If unsure of region, use the country to determine it. US/Canada/Mexico = North America. UK/France/Germany = Europe. China/Japan/Australia = Asia-Pacific. Israel/Saudi/Kenya/South Africa = Middle East & Africa. Brazil/Argentina/Colombia = Latin America. India/Pakistan/Bangladesh = South & Central Asia.

Respond with JSON only. No markdown fences. No preamble.

Response shape:
{
  "sources": [
    {
      "url": "string",
      "title": "string",
      "outlet": "string",
      "outletType": "wire | newspaper | broadcaster | digital | state",
      "country": "2-letter ISO code",
      "region": "one of the 6 exact region names above",
      "language": "English",
      "politicalLean": "left | center-left | center | center-right | right | state-controlled | unknown",
      "reliability": "high | medium | low | mixed"
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
  // Deduplicate by URL before sending to Haiku
  const seen = new Set<string>()
  const deduped = rawSources.filter(s => {
    if (seen.has(s.url)) return false
    seen.add(s.url)
    return true
  })
  const truncated = deduped.slice(0, 50)

  const userPrompt = `Query: ${query}

Raw sources (${truncated.length} of ${rawSources.length} total):
${JSON.stringify(truncated, null, 2)}`

  const { text, costUsd } = await callClaude({
    model: HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'triage',
    maxTokens: 8192,
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
