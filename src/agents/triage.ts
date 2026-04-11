import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { ANTI_HALLUCINATION_RULES, JSON_RULES } from './prompts'

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
  isWireCopy: boolean
  originalSource: string | null
  citesSource: string | null
}

export interface TriageResult {
  sources: TriagedSource[]
  suggestedCategory: string
  suggestedSecondary: string[]
  searchQueryRefinement: string
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a news source triage agent for Overcurrent, a coverage analysis platform. Given a list of raw article results about a topic, your job is:
1. Remove duplicate URLs and near-duplicate articles (same story, same outlet)
2. Identify each source's outlet name, type, country, region, political lean, and reliability
3. Filter out irrelevant results that don't actually relate to the query
4. Detect WIRE SYNDICATION: If an article is from AP, Reuters, or AFP wire service, mark isWireCopy: true and note the original source. 30 AP copies are NOT 30 independent sources.
5. Suggest a primary category for this story from exactly one of these slugs: conflict, politics, economy, tech, labor, climate, health, society, trade
   Additionally, suggest 1-2 secondary categories (from the same list) if the story spans multiple domains.
   Example: A warehouse fire set by a worker protesting wages → primary: "labor", secondary: ["economy", "society"]
   AI regulation in the EU → primary: "tech", secondary: ["politics"]
6. Suggest a refined search query if the original seems too broad or too narrow

IMPORTANT RULES:
- NEVER return an empty sources array. You MUST return at least 10-15 sources, even if relevance is uncertain.
- Keep at LEAST 20-30 unique sources when possible. Do NOT over-filter.
- If few sources seem directly relevant, include sources that are PARTIALLY relevant or cover related topics.
- Maximize regional diversity — keep sources from as many different regions as possible.
- region MUST be exactly one of: "North America", "Europe", "Asia-Pacific", "Middle East & Africa", "Latin America", "South & Central Asia"
- Track source provenance: if an article cites another outlet ("according to NYT..."), note it in citesSource.
- When in doubt about relevance, INCLUDE the source. Over-inclusion is better than missing coverage.

${ANTI_HALLUCINATION_RULES}

${JSON_RULES}

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
      "language": "en",
      "politicalLean": "left | center-left | center | center-right | right | state-controlled | unknown",
      "reliability": "high | medium | low | mixed",
      "isWireCopy": false,
      "originalSource": null,
      "citesSource": null
    }
  ],
  "suggestedCategory": "string",
  "suggestedSecondary": ["string"],
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
  const truncated = deduped.slice(0, 100)

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
    sources: ((parsed.sources ?? []) as unknown as Record<string, unknown>[]).map((s) => ({
      url: String(s.url ?? ''),
      title: String(s.title ?? ''),
      outlet: String(s.outlet ?? ''),
      outletType: String(s.outletType ?? 'digital'),
      country: String(s.country ?? ''),
      region: String(s.region ?? ''),
      language: String(s.language ?? 'en'),
      politicalLean: String(s.politicalLean ?? 'unknown'),
      reliability: String(s.reliability ?? 'unknown'),
      isWireCopy: Boolean(s.isWireCopy ?? false),
      originalSource: s.originalSource ? String(s.originalSource) : null,
      citesSource: s.citesSource ? String(s.citesSource) : null,
    })),
    suggestedCategory: parsed.suggestedCategory ?? 'other',
    suggestedSecondary: Array.isArray(parsed.suggestedSecondary) ? parsed.suggestedSecondary : [],
    searchQueryRefinement: parsed.searchQueryRefinement ?? query,
    costUsd,
  }
}
