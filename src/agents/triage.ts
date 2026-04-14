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
  publishedAt?: string // Merged from RSS/GDELT after triage — not AI-generated
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

CRITICAL: Your ENTIRE response must be valid JSON. No explanations, no markdown, no text before or after the JSON object. Start with { and end with }.

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
}

CRITICAL: Your response must be ONLY a valid JSON object. No text before or after the JSON.
No explanations. No commentary. No markdown code fences.
If zero sources are relevant, return exactly: {"sources": []}
Any text outside the JSON object will cause a system failure.`

// ---------------------------------------------------------------------------
// Outlet name normalization
// ---------------------------------------------------------------------------

const OUTLET_ALIASES: Record<string, string> = {
  'repubblica': 'La Repubblica',
  'yonhapnews agency': 'Yonhap News Agency',
  'yonhapnews': 'Yonhap News Agency',
}

function normalizeOutletName(name: string): string {
  const lower = name.toLowerCase().trim()
  return OUTLET_ALIASES[lower] || name
}

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

  // ── GROUP BY REGION ────────────────────────────────────────────────────
  // Each batch contains sources from ONE region so the triage agent compares
  // similar sources against each other (e.g., all Pakistani outlets together).
  const byRegion = new Map<string, typeof deduped>()
  for (const s of deduped) {
    const region = s.knownRegion || 'Unknown'
    if (!byRegion.has(region)) byRegion.set(region, [])
    byRegion.get(region)!.push(s)
  }

  console.log(`[Triage] Input: ${deduped.length} sources across ${byRegion.size} regions`)
  for (const [region, sources] of byRegion) {
    console.log(`[Triage]   ${region}: ${sources.length} sources`)
  }

  // ── BUILD REGION-GROUPED BATCHES OF ~10 ──────────────────────────────
  // 10 sources per batch keeps Haiku focused and reduces JSON parse failures.
  // Each batch is homogeneous by region for better relevance scoring.
  const BATCH_SIZE = 10
  const allTriagedSources: Record<string, unknown>[] = []
  let costUsd = 0
  let suggestedCategory = 'society'
  let searchQueryRefinement = query
  let suggestedSecondary: string[] = []

  interface TriageBatch {
    region: string
    sources: typeof deduped
  }

  const batches: TriageBatch[] = []
  for (const [region, sources] of byRegion) {
    // Cap per region at 40 sources to avoid wasting triage calls on 100+ US articles
    const capped = sources.slice(0, 40)
    for (let i = 0; i < capped.length; i += BATCH_SIZE) {
      batches.push({ region, sources: capped.slice(i, i + BATCH_SIZE) })
    }
  }

  console.log(`[Triage] Running ${batches.length} batches (${BATCH_SIZE} sources each, grouped by region)`)

  // Run batches — sequential to avoid rate limits, but fast since each is small
  const failedBatchSources: typeof deduped = []

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const { region, sources: batch } = batches[bIdx]
    const slimBatch = batch.map(s => ({
      url: s.url,
      title: s.title.substring(0, 120),
      domain: s.domain,
      country: s.sourcecountry,
      region: s.knownRegion || '',
    }))
    const batchPrompt = `Query: ${query}\n\nRaw sources (batch ${bIdx + 1}/${batches.length}, region: ${region}, ${slimBatch.length} sources):\n${JSON.stringify(slimBatch)}\n\nRespond with JSON only. No explanations.`

    let success = false
    for (let attempt = 0; attempt < 2 && !success; attempt++) {
      try {
        if (attempt > 0) console.log(`[Triage] Batch ${bIdx + 1} (${region}) retry after JSON parse failure`)
        const result = await callClaude({
          model: HAIKU,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: batchPrompt,
          agentType: 'triage',
          maxTokens: 8192,
          storyId,
        })
        costUsd += result.costUsd

        const batchParsed = parseJSON<Record<string, unknown>>(result.text)
        if (batchParsed.sources && Array.isArray(batchParsed.sources)) {
          console.log(`[Triage] Batch ${bIdx + 1} (${region}): ${(batchParsed.sources as unknown[]).length} sources returned`)
          allTriagedSources.push(...(batchParsed.sources as Record<string, unknown>[]))
        } else {
          console.warn(`[Triage] Batch ${bIdx + 1} (${region}): no sources array in response`)
        }
        if (batchParsed.suggestedCategory) suggestedCategory = String(batchParsed.suggestedCategory)
        if (batchParsed.searchQueryRefinement) searchQueryRefinement = String(batchParsed.searchQueryRefinement)
        if (Array.isArray(batchParsed.suggestedSecondary)) suggestedSecondary = batchParsed.suggestedSecondary as string[]
        success = true
      } catch (err) {
        if (attempt === 0) {
          console.warn(`[Triage] Batch ${bIdx + 1} (${region}) attempt 1 failed:`, err instanceof Error ? err.message : err)
        } else {
          console.error(`[Triage] Batch ${bIdx + 1} (${region}) failed after retry:`, err instanceof Error ? err.message : err)
          failedBatchSources.push(...batch)
        }
      }
    }
  }

  // ── MINI-BATCH RECOVERY ─────────────────────────────────────────────────
  // Instead of retrying all failed sources as one big batch (which fails for
  // the same reason), split into mini-batches of 5 sources each. Smaller
  // batches are more likely to produce valid JSON, even if most are irrelevant.
  if (failedBatchSources.length > 0) {
    const MINI_BATCH = 5
    const miniBatchCount = Math.ceil(failedBatchSources.length / MINI_BATCH)
    console.log(`[Triage] Splitting ${failedBatchSources.length} failed sources into ${miniBatchCount} mini-batches of ${MINI_BATCH}`)

    for (let m = 0; m < failedBatchSources.length; m += MINI_BATCH) {
      const miniBatch = failedBatchSources.slice(m, m + MINI_BATCH)
      const slimMini = miniBatch.map(s => ({
        url: s.url,
        title: s.title.substring(0, 120),
        domain: s.domain,
        country: s.sourcecountry,
        region: s.knownRegion || '',
      }))
      const miniPrompt = `Query: ${query}\n\nRaw sources (recovery mini-batch, ${slimMini.length} sources):\n${JSON.stringify(slimMini)}\n\nRespond with JSON only. No explanations.`
      try {
        const result = await callClaude({
          model: HAIKU,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: miniPrompt,
          agentType: 'triage',
          maxTokens: 4096,
          storyId,
        })
        costUsd += result.costUsd
        const parsed = parseJSON<Record<string, unknown>>(result.text)
        if (parsed.sources && Array.isArray(parsed.sources)) {
          console.log(`[Triage] Mini-batch ${Math.floor(m / MINI_BATCH) + 1}: ${(parsed.sources as unknown[]).length} sources recovered`)
          allTriagedSources.push(...(parsed.sources as Record<string, unknown>[]))
        }
      } catch (err) {
        console.error(`[Triage] Mini-batch ${Math.floor(m / MINI_BATCH) + 1} failed:`, err instanceof Error ? err.message : err)
        // Log raw response for debugging parse failures
        console.error(`[Triage] Mini-batch sources: ${slimMini.map(s => s.domain).join(', ')}`)
      }
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
      outlet: normalizeOutletName(String(s.outlet ?? '')),
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
