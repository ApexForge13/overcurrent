import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'
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
- NEVER return an empty sources array. You MUST return at least 30 sources.
- Keep as MANY unique outlets as possible — 40-60 sources is ideal. Do NOT over-filter.
- REGIONAL DIVERSITY IS MANDATORY. If the input contains sources from 5 regions, your output MUST contain sources from at least 4 of those regions. Do NOT filter out an entire region.
- Include at least 3 sources from EVERY region that has ANY relevant articles.
- Non-English articles ARE relevant if they cover the same topic. Include them with their original title.
- If few sources seem directly relevant, include sources that are PARTIALLY relevant or cover related topics.
- region MUST be exactly one of: "North America", "Europe", "Asia-Pacific", "Middle East & Africa", "Latin America", "South & Central Asia"
- Track source provenance: if an article cites another outlet ("according to NYT..."), note it in citesSource.
- When in doubt about relevance, INCLUDE the source. Over-inclusion is better than missing coverage.
- One outlet publishing 10 articles about the same topic = 1 unique source, not 10. Dedup by outlet, keep the most comprehensive article from each.

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
  rawSources: Array<{ url: string; title: string; domain: string; sourcecountry: string; knownRegion?: string }>,
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

  // Ensure regional diversity — don't just take the first 100 (which would be all North American)
  // Group by sourcecountry/region, then sample proportionally
  const byRegion = new Map<string, typeof deduped>()
  for (const s of deduped) {
    const region = s.knownRegion || 'Unknown'
    if (!byRegion.has(region)) byRegion.set(region, [])
    byRegion.get(region)!.push(s)
  }

  const truncated: typeof deduped = []
  const maxTotal = 150
  const regionCount = byRegion.size || 1

  if (regionCount <= 1) {
    // Only one region — just take the first 100
    truncated.push(...deduped.slice(0, maxTotal))
  } else {
    // Multiple regions — guarantee minimum 5 per region, then fill remaining proportionally
    const minPerRegion = Math.min(10, Math.floor(maxTotal / regionCount))
    const remaining: typeof deduped = []

    for (const [, sources] of byRegion) {
      truncated.push(...sources.slice(0, minPerRegion))
      remaining.push(...sources.slice(minPerRegion))
    }

    // Fill remaining slots proportionally
    const slotsLeft = maxTotal - truncated.length
    if (slotsLeft > 0) {
      truncated.push(...remaining.slice(0, slotsLeft))
    }
  }

  // Batch triage: split sources into chunks of 50, run Sonnet on each,
  // merge results. Prevents JSON parse failures from oversized input.
  const BATCH_SIZE = 50
  const allTriagedSources: Record<string, unknown>[] = []
  let costUsd = 0
  let suggestedCategory = 'society'
  let searchQueryRefinement = query
  let suggestedSecondary: string[] = []

  const batches: typeof truncated[] = []
  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    batches.push(truncated.slice(i, i + BATCH_SIZE))
  }

  for (const batch of batches) {
    const batchPrompt = `Query: ${query}\n\nRaw sources (batch ${batches.indexOf(batch) + 1}/${batches.length}, ${batch.length} sources):\n${JSON.stringify(batch, null, 2)}`

    try {
      const result = await callClaude({
        model: SONNET,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: batchPrompt,
        agentType: 'triage',
        maxTokens: 8192,
        storyId,
      })
      costUsd += result.costUsd

      const batchParsed = parseJSON<Record<string, unknown>>(result.text)
      if (batchParsed.sources && Array.isArray(batchParsed.sources)) {
        allTriagedSources.push(...(batchParsed.sources as Record<string, unknown>[]))
      }
      if (batchParsed.suggestedCategory) suggestedCategory = String(batchParsed.suggestedCategory)
      if (batchParsed.searchQueryRefinement) searchQueryRefinement = String(batchParsed.searchQueryRefinement)
      if (Array.isArray(batchParsed.suggestedSecondary)) suggestedSecondary = batchParsed.suggestedSecondary as string[]
    } catch (err) {
      console.error(`[Triage] Batch ${batches.indexOf(batch) + 1} failed:`, err instanceof Error ? err.message : err)
    }
  }

  // Deduplicate merged results by URL
  const seenTriaged = new Set<string>()
  const dedupedSources = allTriagedSources.filter(s => {
    const url = String(s.url ?? '')
    if (!url || seenTriaged.has(url)) return false
    seenTriaged.add(url)
    return true
  })

  const parsed = {
    sources: dedupedSources,
    suggestedCategory,
    searchQueryRefinement,
    suggestedSecondary,
  } as unknown as Omit<TriageResult, 'costUsd'>

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
