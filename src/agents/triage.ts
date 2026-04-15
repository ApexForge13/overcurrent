import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { ANTI_HALLUCINATION_RULES, JSON_RULES } from './prompts'
import { queryToKeywords } from '@/ingestion/rss'
import { findOutletByDomain } from '@/data/outlets'

/** Strip diacritics for matching (á → a, ö → o, etc.) */
function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Pre-check: does this source title match any query keywords?
 * Returns { score, hasAnchor }.
 * Anchors (entity names: countries, people, orgs) are weighted 2x.
 * Generic context words (after, years, votes, party, wins) get +1 each.
 * AUTO-PASS requires hasAnchor=true — generic-only matches must go through Haiku.
 */
function keywordRelevanceScore(title: string, anchors: string[], allKeywords: string[]): { score: number; hasAnchor: boolean } {
  const text = stripDiacritics(title.toLowerCase())
  let score = 0
  let hasAnchor = false
  for (const a of anchors) {
    if (text.includes(stripDiacritics(a))) {
      score += 2  // Anchors are strong signal
      hasAnchor = true
    }
  }
  for (const kw of allKeywords) {
    if (!anchors.includes(kw) && text.includes(stripDiacritics(kw))) score += 1
  }
  return { score, hasAnchor }
}

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
  lowConfidence: boolean
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

const SYSTEM_PROMPT = `You are a news source triage agent for Overcurrent, a coverage analysis platform.

YOUR PHILOSOPHY: Triage is a RECALL filter, not a PRECISION filter. Your job is to cast a wide net. Include anything that MIGHT be relevant — the 4-model debate system will handle quality and relevance scoring. You are NOT the quality filter. The debate models are.

Given a list of raw article results about a topic, your job is:
1. Remove duplicate URLs and near-duplicate articles (same story, same outlet — keep the most comprehensive article)
2. Identify each source's outlet name, type, country, region, political lean, and reliability
3. Detect WIRE SYNDICATION: If an article is from AP, Reuters, or AFP wire service, mark isWireCopy: true and note the original source.
4. Suggest a primary category from: conflict, politics, economy, tech, labor, climate, health, society, trade
5. Suggest 1-2 secondary categories if the story spans multiple domains

INCLUSION RULES (follow these exactly):
- Your job is to INCLUDE sources, not exclude them.
- A source is relevant if it mentions ANY entity, country, event, or consequence related to the story.
- Partial relevance counts. A story about reactions to the event counts. A story about the same region or policy domain counts.
- The ONLY sources you should exclude are those with ZERO connection — completely different topic, different region, different time period.
- When in doubt, INCLUDE. Flag borderline sources as lowConfidence: true but still include them.
- Sources marked [KEYWORD MATCH] or [ANCHOR MATCH] MUST be included.
- Non-English articles covering the same entities are RELEVANT — include them with their original title.
- REGIONAL DIVERSITY IS MANDATORY. Never filter out an entire region.
- region MUST be exactly one of: "North America", "Europe", "Asia-Pacific", "Middle East & Africa", "Latin America", "South & Central Asia"
- Track source provenance: if an article cites another outlet, note it in citesSource.

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
      "citesSource": null,
      "lowConfidence": false
    }
  ],
  "suggestedCategory": "string",
  "suggestedSecondary": ["string"],
  "searchQueryRefinement": "string"
}

CRITICAL: Your response must be ONLY a valid JSON object. No text before or after the JSON.
No explanations. No commentary. No markdown code fences.
INCLUDE everything that has ANY connection to the story. Only exclude total non-matches.
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
// Auto-pass: build a TriagedSource from raw data + outlet registry
// ---------------------------------------------------------------------------

function autoPassSource(
  raw: { url: string; title: string; domain: string; sourcecountry: string; knownRegion?: string },
): Record<string, unknown> {
  const outlet = findOutletByDomain(raw.domain)
  return {
    url: raw.url,
    title: raw.title,
    outlet: outlet?.name ?? raw.domain.replace(/^www\./, ''),
    outletType: outlet?.type ?? 'digital',
    country: outlet?.country ?? raw.sourcecountry ?? '',
    region: outlet?.region ?? raw.knownRegion ?? 'Unknown',
    language: outlet?.language ?? 'en',
    politicalLean: outlet?.politicalLean ?? 'unknown',
    reliability: outlet?.reliability ?? 'unknown',
    isWireCopy: outlet?.type === 'wire',
    originalSource: null,
    citesSource: null,
    lowConfidence: false,
  }
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

  // ── KEYWORD PRE-CHECK ──────────────────────────────────────────────────
  // Extract anchor and context keywords from the query. Each source gets
  // annotated with [ANCHOR MATCH] / [KEYWORD MATCH] before going to Haiku.
  // This gives the model a strong prior and reduces nondeterministic filtering.
  const queryKw = queryToKeywords(query)
  let anchorMatches = 0
  let keywordMatches = 0
  let genericOnlyMatches = 0
  for (const s of deduped) {
    const { score, hasAnchor } = keywordRelevanceScore(s.title, queryKw.anchors, queryKw.all)
    if (score >= 2 && hasAnchor) anchorMatches++
    else if (score >= 2 && !hasAnchor) genericOnlyMatches++
    else if (score >= 1) keywordMatches++
  }
  console.log(`[Triage] Keyword pre-check: ${anchorMatches} anchor matches, ${keywordMatches} keyword-only, ${genericOnlyMatches} generic-only (will NOT auto-pass) out of ${deduped.length} sources`)

  console.log(`[Triage] Input: ${deduped.length} sources across ${byRegion.size} regions`)
  for (const [region, sources] of byRegion) {
    console.log(`[Triage]   ${region}: ${sources.length} sources`)
  }

  // ── BUILD REGION-GROUPED BATCHES OF 5 ───────────────────────────────
  // Small batches prevent Haiku from pattern-matching "mostly junk" and
  // doing bulk rejection. 5 sources per batch = higher per-source attention.
  const BATCH_SIZE = 5
  const allTriagedSources: Record<string, unknown>[] = []
  let costUsd = 0
  let suggestedCategory = 'society'
  let searchQueryRefinement = query
  let suggestedSecondary: string[] = []
  const MINIMUM_SOURCES = 40

  interface TriageBatch {
    region: string
    sources: typeof deduped
  }

  const batches: TriageBatch[] = []
  for (const [region, sources] of byRegion) {
    // Cap per region at 60 sources — with auto-pass, anchor matches skip Haiku anyway
    const capped = sources.slice(0, 60)
    for (let i = 0; i < capped.length; i += BATCH_SIZE) {
      batches.push({ region, sources: capped.slice(i, i + BATCH_SIZE) })
    }
  }

  console.log(`[Triage] Running ${batches.length} batches (${BATCH_SIZE} sources each, grouped by region)`)

  // Run batches — sequential to avoid rate limits, but fast since each is small
  const failedBatchSources: typeof deduped = []

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const { region, sources: batch } = batches[bIdx]

    // ── ANCHOR AUTO-PASS: score ≥ 2 AND has entity anchor → skip Haiku ──
    // Generic keyword matches (score ≥ 2 but no anchor) MUST go through Haiku.
    // This prevents "Fox News: man arrested after years on the run" from auto-passing
    // on a Hungary story just because "after" and "years" are in the query.
    const anchorPassed: typeof batch = []
    const needsHaiku: typeof batch = []
    for (const s of batch) {
      const { score, hasAnchor } = keywordRelevanceScore(s.title, queryKw.anchors, queryKw.all)
      if (score >= 2 && hasAnchor) {
        anchorPassed.push(s)
      } else {
        needsHaiku.push(s)
      }
    }

    // Auto-pass anchor-matched sources directly into results
    if (anchorPassed.length > 0) {
      for (const s of anchorPassed) {
        allTriagedSources.push(autoPassSource(s))
      }
    }

    if (needsHaiku.length === 0) {
      console.log(`[Triage] Batch ${bIdx + 1} (${region}): auto-passed all ${anchorPassed.length} sources (anchor match)`)
      continue
    }

    if (anchorPassed.length > 0) {
      console.log(`[Triage] Batch ${bIdx + 1} (${region}): auto-passed ${anchorPassed.length}, sending ${needsHaiku.length} to Haiku`)
    }

    const slimBatch = needsHaiku.map(s => {
      const { score, hasAnchor } = keywordRelevanceScore(s.title, queryKw.anchors, queryKw.all)
      const tag = hasAnchor ? ' [ANCHOR MATCH]' : score >= 1 ? ' [KEYWORD MATCH]' : ''
      return {
        url: s.url,
        title: s.title.substring(0, 120) + tag,
        domain: s.domain,
        country: s.sourcecountry,
        region: s.knownRegion || '',
      }
    })
    const batchPrompt = `Query: ${query}\n\nRaw sources (batch ${bIdx + 1}/${batches.length}, region: ${region}, ${slimBatch.length} sources):\n${JSON.stringify(slimBatch)}\n\nRespond with JSON only. Include ALL [KEYWORD MATCH] sources.`

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
          console.log(`[Triage] Batch ${bIdx + 1} (${region}): ${(batchParsed.sources as unknown[]).length} sources returned from Haiku`)
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
          failedBatchSources.push(...needsHaiku)
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

  // ── EXPANDED RELEVANCE RE-TRIAGE ─────────────────────────────────────
  // If initial triage was too aggressive, re-run rejected batches with a
  // more inclusive prompt. Common for non-crisis stories (elections,
  // policy, economy) where coverage uses diverse angles.
  if (allTriagedSources.length < MINIMUM_SOURCES) {
    console.log(`[Triage] Only ${allTriagedSources.length} sources passed (minimum: ${MINIMUM_SOURCES}). Running expanded relevance pass.`)

    const EXPANDED_PROMPT = SYSTEM_PROMPT + `\n\nSECOND PASS — EXPANDED RELEVANCE: The initial triage was too strict and returned fewer than ${MINIMUM_SOURCES} sources. For this pass:
- Include sources that cover CONSEQUENCES or IMPLICATIONS of the topic, not just the event itself
- Include sources that mention key entities (people, parties, countries) even if the primary focus differs
- Include sources providing historical CONTEXT, analogous events, or expert analysis
- Non-English articles covering the same entities are RELEVANT — include them
- Be MORE inclusive. A tangentially relevant source is better than a missing perspective.
- You MUST return at least 5 sources from this batch if any are even partially relevant.`

    // Re-run ALL original batches with expanded prompt
    const expandedBatches = batches.filter((_, idx) => {
      // Find batches that produced few or no results
      return true // re-run all since we can't track per-batch output easily
    }).slice(0, 15) // Cap at 15 batches to limit cost

    for (let bIdx = 0; bIdx < expandedBatches.length; bIdx++) {
      const { region, sources: batch } = expandedBatches[bIdx]

      // ── ANCHOR AUTO-PASS (expanded pass) — requires entity anchor ──
      const anchorPassed: typeof batch = []
      const needsHaiku: typeof batch = []
      for (const s of batch) {
        // Skip already-triaged URLs
        if (allTriagedSources.some(t => String(t.url) === s.url)) continue
        const { score, hasAnchor } = keywordRelevanceScore(s.title, queryKw.anchors, queryKw.all)
        if (score >= 2 && hasAnchor) {
          anchorPassed.push(s)
        } else {
          needsHaiku.push(s)
        }
      }

      if (anchorPassed.length > 0) {
        for (const s of anchorPassed) {
          allTriagedSources.push(autoPassSource(s))
        }
        console.log(`[Triage] Expanded batch ${bIdx + 1} (${region}): Auto-passed ${anchorPassed.length} anchor-matched sources, sending ${needsHaiku.length} to Haiku`)
      }

      if (needsHaiku.length === 0) continue

      const slimBatch = needsHaiku.map(s => {
        const { score, hasAnchor } = keywordRelevanceScore(s.title, queryKw.anchors, queryKw.all)
        const tag = hasAnchor ? ' [ANCHOR MATCH]' : score >= 1 ? ' [KEYWORD MATCH]' : ''
        return {
          url: s.url,
          title: s.title.substring(0, 120) + tag,
          domain: s.domain,
          country: s.sourcecountry,
          region: s.knownRegion || '',
        }
      })

      const batchPrompt = `Query: ${query}\n\nRaw sources (EXPANDED PASS batch ${bIdx + 1}/${expandedBatches.length}, region: ${region}, ${slimBatch.length} sources):\n${JSON.stringify(slimBatch)}\n\nRespond with JSON only. No explanations.`

      try {
        const result = await callClaude({
          model: HAIKU,
          systemPrompt: EXPANDED_PROMPT,
          userPrompt: batchPrompt,
          agentType: 'triage',
          maxTokens: 8192,
          storyId,
        })
        costUsd += result.costUsd
        const parsed = parseJSON<Record<string, unknown>>(result.text)
        if (parsed.sources && Array.isArray(parsed.sources)) {
          console.log(`[Triage] Expanded batch ${bIdx + 1} (${region}): ${(parsed.sources as unknown[]).length} additional sources from Haiku`)
          allTriagedSources.push(...(parsed.sources as Record<string, unknown>[]))
        }
      } catch (err) {
        console.warn(`[Triage] Expanded batch ${bIdx + 1} (${region}) failed:`, err instanceof Error ? err.message : err)
      }
    }

    console.log(`[Triage] After expanded pass: ${allTriagedSources.length} total sources`)
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
      lowConfidence: Boolean(s.lowConfidence ?? false),
    })).filter(s => {
      // Filter out snippet-only sources that don't mention core query entities
      if (s.reliability === 'unknown' && s.politicalLean === 'unknown') {
        // If triage couldn't identify the outlet at all, keep it but log
        console.log(`[Triage] Unknown outlet passed: ${s.outlet} (${s.url})`)
      }
      return true // Keep all for now — the expanded triage handles quality
    }),
    suggestedCategory: parsed.suggestedCategory ?? 'other',
    suggestedSecondary: Array.isArray(parsed.suggestedSecondary) ? parsed.suggestedSecondary : [],
    searchQueryRefinement: parsed.searchQueryRefinement ?? query,
    costUsd,
  }
}
