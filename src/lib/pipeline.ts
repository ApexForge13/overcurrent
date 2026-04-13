import { prisma } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { slugify, regionList } from '@/lib/utils'
import { searchGdeltGlobal, getRegionFromCountryName } from '@/ingestion/gdelt'
import { scanRssFeeds, queryToKeywords } from '@/ingestion/rss'
// searchReddit removed — Reddit is Stream 2 only (Discourse Gap)
import { findOutletByDomain } from '@/data/outlets'
import { fetchArticle } from '@/ingestion/article-fetcher'
import { triageSources } from '@/agents/triage'
import { analyzeSilence } from '@/agents/silence'
import { synthesize } from '@/agents/synthesis'
import { runRegionalDebate, moderatorToRegionalAnalysis } from '@/lib/debate'
import type { DebateRoundData } from '@/lib/debate'
import { generateSocialDrafts } from '@/agents/social-drafts'
import { fetchRedditDiscourse } from '@/ingestion/reddit-discourse'
import { fetchTwitterDiscourse } from '@/ingestion/twitter-discourse'
import { analyzeDiscourse } from '@/agents/discourse'
import type { TriagedSource } from '@/agents/triage'
import type { SilenceAnalysis } from '@/agents/silence'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    results.push(...(await Promise.all(batch.map(fn))))
  }
  return results
}

/** Convert GDELT seendate (YYYYMMDDTHHmmSS) to ISO string */
function gdeltSeenDateToISO(seendate: string): string {
  if (!seendate || seendate.length < 15) return ''
  try {
    const y = seendate.substring(0, 4)
    const m = seendate.substring(4, 6)
    const d = seendate.substring(6, 8)
    const h = seendate.substring(9, 11)
    const min = seendate.substring(11, 13)
    const s = seendate.substring(13, 15)
    return `${y}-${m}-${d}T${h}:${min}:${s}Z`
  } catch {
    return ''
  }
}

/** Map country code → globe region ID */
function mapCountryToRegionId(country: string): string {
  const map: Record<string, string> = {
    US: 'us', CA: 'ca', MX: 'mx',
    GB: 'uk', IE: 'uk',
    FR: 'eu', DE: 'eu', IT: 'eu', ES: 'eu', NL: 'eu', SE: 'eu', NO: 'eu', BE: 'eu',
    RU: 'ru', TR: 'tr', IR: 'ir', IL: 'il',
    SA: 'me', QA: 'me', AE: 'me',
    KE: 'af', ZA: 'af', NG: 'af',
    IN: 'in', PK: 'pk', BD: 'in', LK: 'in', NP: 'in',
    CN: 'cn', JP: 'jp', KR: 'kr',
    SG: 'sea', TH: 'sea', HK: 'cn', TW: 'cn',
    AU: 'au',
    BR: 'la', AR: 'la', CO: 'la', CL: 'la', PE: 'la', VE: 'la', UY: 'la',
  }
  return map[country] || 'us'
}

/** Format timeline label based on span duration */
function formatTimelineLabel(date: Date, totalSpanMs: number): string {
  const hours = totalSpanMs / (1000 * 60 * 60)
  if (hours < 24) {
    return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })
  } else if (hours < 168) {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'UTC' })
  } else {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
}

export interface TimelineBucket {
  timestamp: string
  label: string
  hoursSinceFirst: number
  regions: Array<{
    region_id: string
    outlet_count: number
    key_outlets: string[]
    country: string
  }>
}

/** Build propagation timeline from real publication timestamps */
function buildTimelineBuckets(
  articles: Array<{ publishedAt?: string; region: string; outlet: string; country: string }>,
  bucketCount: number = 6,
): TimelineBucket[] {
  const withDates = articles
    .filter(a => a.publishedAt && !isNaN(new Date(a.publishedAt).getTime()))
    .map(a => ({ ...a, date: new Date(a.publishedAt!) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (withDates.length === 0) return []

  const earliest = withDates[0].date.getTime()
  // Cap at 14 days
  const maxSpan = 14 * 24 * 60 * 60 * 1000
  const rawLatest = Math.max(withDates[withDates.length - 1].date.getTime(), Date.now())
  const latest = Math.min(rawLatest, earliest + maxSpan)
  const span = latest - earliest

  // If all articles have the same timestamp, create a single bucket
  if (span < 60_000) {
    const regionMap = new Map<string, { outlets: Set<string>; country: string }>()
    for (const a of withDates) {
      const rid = mapCountryToRegionId(a.country)
      if (!regionMap.has(rid)) regionMap.set(rid, { outlets: new Set(), country: a.country })
      regionMap.get(rid)!.outlets.add(a.outlet)
    }
    return [{
      timestamp: new Date(earliest).toISOString(),
      label: formatTimelineLabel(new Date(earliest), 0),
      hoursSinceFirst: 0,
      regions: Array.from(regionMap.entries()).map(([rid, d]) => ({
        region_id: rid,
        outlet_count: d.outlets.size,
        key_outlets: Array.from(d.outlets).slice(0, 5),
        country: d.country,
      })),
    }]
  }

  const buckets: TimelineBucket[] = []
  const bucketSize = span / bucketCount

  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = earliest + (i * bucketSize)
    const bucketEnd = earliest + ((i + 1) * bucketSize)
    const bucketDate = new Date(bucketStart)

    // Cumulative: all articles published up to this bucket's end
    const articlesUpTo = withDates.filter(a => a.date.getTime() <= bucketEnd)

    const regionMap = new Map<string, { outlets: Set<string>; country: string }>()
    for (const a of articlesUpTo) {
      const rid = mapCountryToRegionId(a.country)
      if (!regionMap.has(rid)) regionMap.set(rid, { outlets: new Set(), country: a.country })
      regionMap.get(rid)!.outlets.add(a.outlet)
    }

    buckets.push({
      timestamp: bucketDate.toISOString(),
      label: formatTimelineLabel(bucketDate, span),
      hoursSinceFirst: Math.round((bucketStart - earliest) / (1000 * 60 * 60)),
      regions: Array.from(regionMap.entries()).map(([rid, d]) => ({
        region_id: rid,
        outlet_count: d.outlets.size,
        key_outlets: Array.from(d.outlets).slice(0, 5),
        country: d.country,
      })),
    })
  }

  return buckets
}

/**
 * Merge deterministic timeline buckets with AI-enriched framing.
 * The AI often only enriches 2-3 regions. This ensures ALL regions with
 * actual sources appear on the map with correct outlet counts.
 */
function buildFinalTimeline(
  buckets: TimelineBucket[],
  aiTimeline: Array<{
    hour: number
    timestamp?: string
    label: string
    description: string
    regions: Array<{ region_id: string; status: string; coverage_volume: number; dominant_quote: string; outlet_count: number; key_outlets: string[] }>
    flows: Array<{ from: string; to: string; type: string }>
  }>,
): typeof aiTimeline {
  if (buckets.length === 0) return aiTimeline

  // If AI returned nothing usable, build entirely from buckets
  const frames = buckets.map((bucket, i) => {
    // Try to find matching AI frame by hour or index
    const aiFrame = aiTimeline.find(f => f.hour === bucket.hoursSinceFirst)
      ?? aiTimeline[i]
      ?? null

    // Build region list from deterministic bucket data
    const regions = bucket.regions.map((br, ri) => {
      // See if AI enriched this region
      const aiRegion = aiFrame?.regions?.find(ar => ar.region_id === br.region_id)

      return {
        region_id: br.region_id,
        status: aiRegion?.status || (ri === 0 && i === 0 ? 'original' : 'wire_copy'),
        coverage_volume: aiRegion?.coverage_volume ?? Math.min(100, br.outlet_count * 15),
        dominant_quote: aiRegion?.dominant_quote || `${br.outlet_count} outlets covering`,
        outlet_count: br.outlet_count, // Always use deterministic count
        key_outlets: br.key_outlets,   // Always use deterministic outlets
      }
    })

    // Build flows: connect first region to all others
    const flows: Array<{ from: string; to: string; type: string }> = aiFrame?.flows ?? []
    if (flows.length === 0 && regions.length >= 2) {
      const origin = regions[0].region_id
      for (let r = 1; r < regions.length; r++) {
        flows.push({
          from: origin,
          to: regions[r].region_id,
          type: regions[r].status || 'wire_copy',
        })
      }
    }

    return {
      hour: bucket.hoursSinceFirst,
      timestamp: bucket.timestamp,
      label: bucket.label,
      description: aiFrame?.description || `${regions.length} regions, ${regions.reduce((n, r) => n + r.outlet_count, 0)} outlets`,
      regions,
      flows,
    }
  })

  console.log(`[timeline] Built ${frames.length} frames. Regions per frame: ${frames.map(f => f.regions.length).join(', ')}`)
  return frames
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runVerifyPipeline(
  query: string,
  onProgress: (event: string, data: unknown) => void,
): Promise<string> {
  const startTime = Date.now()
  let totalCost = 0

  // ── PHASE 1: SEARCH ──────────────────────────────────────────────────

  // ── STREAM 1: NEWS OUTLETS ONLY ────────────────────────────────────────
  // News outlets feed: debate engine, framing split, buried evidence,
  // fact survival, and propagation map.
  // Social media (Reddit/Twitter) is handled separately in Stream 2 below
  // and feeds only the Discourse Gap section.
  const rssResults = await scanRssFeeds(query)

  // GDELT is best-effort — 15s timeout, don't block pipeline on it
  let allGdelt: Awaited<ReturnType<typeof searchGdeltGlobal>> = []
  try {
    allGdelt = await Promise.race([
      searchGdeltGlobal(query),
      new Promise<typeof allGdelt>((resolve) => setTimeout(() => resolve([]), 15_000)),
    ])
  } catch {
    // GDELT failed — continue with RSS only
  }

  // Deduplicate by URL only — let triage handle relevance filtering
  const seenUrls = new Set<string>()
  const rawSources: Array<{ url: string; title: string; domain: string; sourcecountry: string; knownRegion: string; publishedAt: string }> = []

  // Helper: determine sourcecountry and region for a domain
  function getOutletInfo(domain: string, gdeltCountry?: string): { country: string; region: string } {
    const outlet = findOutletByDomain(domain)
    if (outlet) {
      const isoToName: Record<string, string> = {
        US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
        FR: 'France', DE: 'Germany', IT: 'Italy', ES: 'Spain', IE: 'Ireland',
        NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', BE: 'Belgium', RU: 'Russia',
        JP: 'Japan', CN: 'China', KR: 'South Korea', SG: 'Singapore', HK: 'Hong Kong',
        TW: 'Taiwan', TH: 'Thailand', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh',
        LK: 'Sri Lanka', NP: 'Nepal', QA: 'Qatar', SA: 'Saudi Arabia', IL: 'Israel',
        TR: 'Turkey', KE: 'Kenya', ZA: 'South Africa', NG: 'Nigeria', AE: 'United Arab Emirates',
        BR: 'Brazil', AR: 'Argentina', MX: 'Mexico', CO: 'Colombia', CL: 'Chile',
        PE: 'Peru', VE: 'Venezuela', UY: 'Uruguay',
      }
      return { country: isoToName[outlet.country] || outlet.country, region: outlet.region }
    }
    if (gdeltCountry) {
      const region = getRegionFromCountryName(gdeltCountry)
      return { country: gdeltCountry, region: region !== 'Unknown' ? region : '' }
    }
    return { country: '', region: '' }
  }

  for (const article of allGdelt) {
    if (article.url && !seenUrls.has(article.url)) {
      seenUrls.add(article.url)
      const info = getOutletInfo(article.domain, article.sourcecountry)
      rawSources.push({
        url: article.url,
        title: article.title,
        domain: article.domain,
        sourcecountry: info.country,
        knownRegion: info.region,
        publishedAt: gdeltSeenDateToISO(article.seendate),
      })
    }
  }

  // Add RSS results — use outlet registry for country/region
  for (const rss of rssResults) {
    if (rss.url && !seenUrls.has(rss.url)) {
      seenUrls.add(rss.url)
      try {
        const domain = new URL(rss.url).hostname
        const info = getOutletInfo(domain)
        rawSources.push({
          url: rss.url,
          title: rss.title,
          domain,
          sourcecountry: info.country,
          knownRegion: info.region,
          publishedAt: rss.publishedAt || '',
        })
      } catch {
        rawSources.push({ url: rss.url, title: rss.title, domain: '', sourcecountry: '', knownRegion: '', publishedAt: rss.publishedAt || '' })
      }
    }
  }

  // Reddit is excluded from Stream 1 — social media feeds Stream 2 (Discourse Gap) only.

  // Count unique countries and regions across ALL news sources
  const countriesFound = new Set(rawSources.map((s) => s.sourcecountry).filter(Boolean))
  const regionsFound = new Set(
    rawSources
      .map((s) => getRegionFromCountryName(s.sourcecountry))
      .filter((r) => r !== 'Unknown'),
  )

  // ── PER-OUTLET DEDUPLICATION ─────────────────────────────────────────
  // Collapse multiple articles from the same outlet into the best 2.
  // Keeps the most recent by array order (RSS feeds return newest first).
  // This frees slots for international outlets that were being crowded out
  // by 14x The Hill / 15x Axios duplicates.
  const outletCounts = new Map<string, number>()
  const MAX_PER_OUTLET = 2
  const dedupedSources = rawSources.filter((s) => {
    // Normalize domain to outlet name: strip www., use base domain
    const key = s.domain.replace(/^www\./, '').toLowerCase()
    const count = outletCounts.get(key) ?? 0
    if (count >= MAX_PER_OUTLET) return false
    outletCounts.set(key, count + 1)
    return true
  })

  onProgress('search', {
    phase: 'search',
    message: `Found ${rawSources.length} raw → ${dedupedSources.length} after per-outlet dedup, across ${countriesFound.size} countries in ${regionsFound.size} regions`,
    sourceCount: dedupedSources.length,
    countryCount: countriesFound.size,
    regionCount: regionsFound.size,
  })

  // ── PHASE 2: TRIAGE ──────────────────────────────────────────────────

  const triageResult = await triageSources(dedupedSources, query)
  totalCost += triageResult.costUsd

  // Fallback: if triage returned 0 sources, use deduplicated sources with regional diversity
  if (triageResult.sources.length === 0 && dedupedSources.length > 0) {
    // Sample regionally — don't just take first 50 (which would be all North American)
    const fallbackByRegion = new Map<string, typeof dedupedSources>()
    for (const s of dedupedSources) {
      const r = s.knownRegion || 'Unknown'
      if (!fallbackByRegion.has(r)) fallbackByRegion.set(r, [])
      fallbackByRegion.get(r)!.push(s)
    }
    const fallbackSampled: typeof dedupedSources = []
    const perRegion = Math.max(5, Math.floor(50 / (fallbackByRegion.size || 1)))
    for (const [, sources] of fallbackByRegion) {
      fallbackSampled.push(...sources.slice(0, perRegion))
    }
    // Fill remaining up to 50
    if (fallbackSampled.length < 50) {
      const usedFallback = new Set(fallbackSampled.map(s => s.url))
      for (const s of dedupedSources) {
        if (fallbackSampled.length >= 50) break
        if (!usedFallback.has(s.url)) fallbackSampled.push(s)
      }
    }

    const fallbackSources = fallbackSampled.slice(0, 50).map((rs) => ({
      url: rs.url,
      title: rs.title,
      outlet: rs.domain.replace(/^www\./, ''),
      outletType: 'digital' as const,
      country: rs.sourcecountry ? rs.sourcecountry.substring(0, 2).toUpperCase() : 'US',
      region: rs.knownRegion || 'North America',
      language: 'en',
      politicalLean: 'unknown',
      reliability: 'unknown',
      isWireCopy: false,
      originalSource: null,
      citesSource: null,
      publishedAt: rs.publishedAt || undefined,
    }))
    triageResult.sources = fallbackSources
    const fallbackRegions = new Set(fallbackSources.map(s => s.region))
    const fallbackCountries = new Set(fallbackSources.map(s => s.country))
    onProgress('triage', {
      phase: 'triage',
      message: `Triage returned 0 — using ${fallbackSources.length} raw sources as fallback (${fallbackCountries.size} countries, ${fallbackRegions.size} regions)`,
      sourceCount: fallbackSources.length,
    })
    console.warn(`[Triage] FALLBACK: ${fallbackSources.length} sources from ${fallbackCountries.size} countries, ${fallbackRegions.size} regions`)
  } else {
    onProgress('triage', {
      phase: 'triage',
      message: `Triaged ${triageResult.sources.length} unique sources`,
      sourceCount: triageResult.sources.length,
    })
  }

  // Override triage region with outlet-registry-known region where available
  const knownRegionMap = new Map<string, string>()
  for (const rs of rawSources) {
    if (rs.knownRegion && rs.url) knownRegionMap.set(rs.url, rs.knownRegion)
  }
  for (const source of triageResult.sources) {
    const known = knownRegionMap.get(source.url)
    if (known && regionList.includes(known as typeof regionList[number])) {
      source.region = known
    }
  }

  // Attach publishedAt from raw sources to triaged sources
  const publishedAtMap = new Map<string, string>()
  for (const rs of rawSources) {
    if (rs.publishedAt && rs.url) publishedAtMap.set(rs.url, rs.publishedAt)
  }
  for (const source of triageResult.sources) {
    source.publishedAt = publishedAtMap.get(source.url) || undefined
  }

  // ── POST-TRIAGE DEDUP: max 2 articles per outlet name ─────────────────
  // The triage AI agent returns outlet names (e.g., "The Hill", "Axios").
  // Multiple batches can return the same outlet 10-16 times.
  // Cap at 2 per outlet to free slots for international sources.
  const outletCountsPost = new Map<string, number>()
  const beforeDedup = triageResult.sources.length
  triageResult.sources = triageResult.sources.filter((s) => {
    const key = s.outlet.toLowerCase().trim()
    const count = outletCountsPost.get(key) ?? 0
    if (count >= 2) return false
    outletCountsPost.set(key, count + 1)
    return true
  })
  const dupOutlets = [...outletCountsPost.entries()]
    .filter(([, c]) => c >= 2)
    .map(([name]) => name)
  console.log(`[dedup] Post-triage: ${beforeDedup} → ${triageResult.sources.length} sources (${beforeDedup - triageResult.sources.length} removed). Top dup outlets: ${dupOutlets.slice(0, 5).join(', ')}`)

  // ── REGIONAL DIVERSITY ENFORCEMENT ───────────────────────────────────
  // Ensure minimum representation per region. Without this, English-language
  // US articles dominate triage scoring and crowd out international outlets.
  const REGION_MINIMUMS: Record<string, number> = {
    'North America': 15,
    'Europe': 10,
    'Middle East & Africa': 10,
    'Asia-Pacific': 8,
    'South & Central Asia': 5,
    'Latin America': 5,
  }
  const MAX_PER_REGION_PCT = 0.5 // No region > 50% of total

  // Group sources by region
  const sourcesByReg = new Map<string, TriagedSource[]>()
  for (const s of triageResult.sources) {
    const bucket = sourcesByReg.get(s.region) ?? []
    bucket.push(s)
    sourcesByReg.set(s.region, bucket)
  }

  // If any region is below minimum and we have extra raw sources, backfill
  const usedUrls = new Set(triageResult.sources.map(s => s.url))
  for (const [region, min] of Object.entries(REGION_MINIMUMS)) {
    const current = sourcesByReg.get(region) ?? []
    if (current.length < min) {
      // Find unused raw sources from this region
      const backfill = dedupedSources
        .filter(rs => rs.knownRegion === region && !usedUrls.has(rs.url))
        .slice(0, min - current.length)
        .map(rs => ({
          url: rs.url,
          title: rs.title,
          outlet: rs.domain.replace(/^www\./, ''),
          outletType: 'digital' as const,
          country: rs.sourcecountry ? rs.sourcecountry.substring(0, 2).toUpperCase() : 'US',
          region,
          language: 'en',
          politicalLean: 'unknown',
          reliability: 'unknown',
          isWireCopy: false,
          originalSource: null,
          citesSource: null,
          publishedAt: publishedAtMap.get(rs.url) || undefined,
        }))
      for (const s of backfill) {
        triageResult.sources.push(s)
        usedUrls.add(s.url)
      }
      if (backfill.length > 0) {
        console.log(`[diversity] Backfilled ${backfill.length} sources for ${region} (was ${current.length}, min ${min})`)
      }
    }
  }

  // Enforce max 50% per region
  const totalAfterBackfill = triageResult.sources.length
  const maxPerRegion = Math.floor(totalAfterBackfill * MAX_PER_REGION_PCT)
  const regCounts = new Map<string, number>()
  triageResult.sources = triageResult.sources.filter(s => {
    const count = regCounts.get(s.region) ?? 0
    if (count >= maxPerRegion) return false
    regCounts.set(s.region, count + 1)
    return true
  })

  // Log final diversity stats
  const finalByRegion = new Map<string, number>()
  const finalByCountry = new Set<string>()
  for (const s of triageResult.sources) {
    finalByRegion.set(s.region, (finalByRegion.get(s.region) ?? 0) + 1)
    finalByCountry.add(s.country)
  }
  console.log(`[diversity] Final: ${triageResult.sources.length} sources, ${finalByCountry.size} countries, ${finalByRegion.size} regions`)
  for (const [region, count] of [...finalByRegion.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`[diversity]   ${region}: ${count} sources`)
  }

  // ── PHASE 3: FETCH ───────────────────────────────────────────────────

  const topSources = triageResult.sources.slice(0, 50) // Increased from 30 to 50 for better coverage
  const fetchedArticles = await parallelWithLimit(topSources, 5, async (source) => {
    const article = await fetchArticle(source.url)
    return {
      ...source,
      content: article?.content ?? undefined,
    }
  })

  const fetchedCount = fetchedArticles.filter((a) => a.content).length

  onProgress('fetch', {
    phase: 'fetch',
    message: `Fetched ${fetchedCount} articles`,
    fetchedCount,
  })

  // ── PHASE 4: ANALYSIS ────────────────────────────────────────────────

  // Group sources by region
  const sourcesByRegion = new Map<string, Array<{ url: string; title: string; outlet: string; content?: string }>>()
  for (const region of regionList) {
    sourcesByRegion.set(region, [])
  }
  for (const source of fetchedArticles) {
    const bucket = sourcesByRegion.get(source.region)
    if (bucket) {
      bucket.push({
        url: source.url,
        title: source.title,
        outlet: source.outlet,
        content: source.content,
      })
    }
  }

  // Build a brief summary of all sources for cross-region omission detection
  const allRegionsSummary = fetchedArticles
    .map((s) => `[${s.region}] ${s.outlet}: ${s.title}`)
    .join('\n')

  // Determine which regions have sources and which don't
  const regionsWithSources: string[] = []
  const regionsWithoutSources: string[] = []
  for (const [region, sources] of sourcesByRegion) {
    if (sources.length > 0) {
      regionsWithSources.push(region)
    } else {
      regionsWithoutSources.push(region)
    }
  }

  // Run debate for regions with sources + silence for regions without (all in parallel)
  let allDebateRounds: DebateRoundData[] = []

  const [debateResults, silenceAnalyses] = await Promise.all([
    // Debate: 3-round AI debate per region with sources
    Promise.all(
      regionsWithSources.map(async (region) => {
        const sources = sourcesByRegion.get(region)!
        const result = await runRegionalDebate(region, sources, query, undefined, (msg) => {
          onProgress('debate', {
            phase: 'analysis',
            message: msg,
            region,
            type: 'debate',
          })
        })
        totalCost += result.totalCost
        return result
      }),
    ),
    // Silence analysis for regions with no sources
    Promise.all(
      regionsWithoutSources.map(async (region) => {
        const otherRegionsSummary = fetchedArticles
          .filter((s) => s.region !== region)
          .map((s) => `[${s.region}] ${s.outlet}: ${s.title}`)
          .join('\n')
        const result = await analyzeSilence(region, query, 0, otherRegionsSummary)
        totalCost += result.costUsd
        onProgress('analysis', {
          phase: 'analysis',
          message: `Analyzed ${region} (silence)`,
          region,
          type: 'silence',
        })
        return result
      }),
    ),
  ])

  // Convert debate results to RegionalAnalysis format for synthesis
  const regionalAnalyses = debateResults.map((d) =>
    moderatorToRegionalAnalysis(d.moderatorOutput, d.moderatorOutput.region, d.totalCost)
  )

  // Collect all debate rounds for DB storage
  allDebateRounds = debateResults.flatMap((d) => d.debateRounds)

  // ── PHASE 5: SYNTHESIS ───────────────────────────────────────────────

  onProgress('synthesis', {
    phase: 'synthesis',
    message: 'Generating final report',
  })

  const countries = new Set(triageResult.sources.map((s: TriagedSource) => s.country))
  const regions = new Set(triageResult.sources.map((s: TriagedSource) => s.region))

  // Build propagation timeline from real publication timestamps
  const timelineBuckets = buildTimelineBuckets(
    fetchedArticles.map(a => ({
      publishedAt: a.publishedAt,
      region: a.region,
      outlet: a.outlet,
      country: a.country,
    })),
  )

  let synthesisResult
  try {
    synthesisResult = await synthesize(
      query,
      regionalAnalyses,
      silenceAnalyses,
      triageResult.sources.length,
      countries.size,
      regions.size,
      timelineBuckets,
    )
    totalCost += synthesisResult.costUsd
  } catch (synthErr) {
    onProgress('error', {
      phase: 'error',
      message: `Synthesis failed: ${synthErr instanceof Error ? synthErr.message : 'Unknown error'}`,
    })
    throw synthErr
  }

  // ── PHASE 6: SAVE ────────────────────────────────────────────────────

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
  const slug = slugify(synthesisResult.headline || query).slice(0, 80)

  // Ensure slug uniqueness
  let uniqueSlug = slug
  const existing = await prisma.story.findUnique({ where: { slug } })
  if (existing) {
    uniqueSlug = `${slug}-${Date.now().toString(36)}`
  }

  const story = await prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
    const story = await tx.story.create({
      data: {
        slug: uniqueSlug,
        status: 'review',
        headline: synthesisResult.headline,
        synopsis: synthesisResult.synopsis,
        confidenceLevel: synthesisResult.confidenceLevel,
        confidenceNote: JSON.stringify({
          note: synthesisResult.confidenceNote,
          buriedEvidence: synthesisResult.buriedEvidence,
          propagationTimeline: buildFinalTimeline(timelineBuckets, synthesisResult.propagationTimeline),
          factSurvival: synthesisResult.factSurvival,
        }),
        category: triageResult.suggestedCategory,
        primaryCategory: triageResult.suggestedCategory || null,
        secondaryCategories: triageResult.suggestedSecondary?.length ? JSON.stringify(triageResult.suggestedSecondary) : null,
        searchQuery: query,
        sourceCount: triageResult.sources.length,
        countryCount: countries.size,
        regionCount: regions.size,
        consensusScore: synthesisResult.consensusScore,
        totalCost,
        analysisSeconds: elapsedSeconds,
      },
    })

    // Sources
    if (triageResult.sources.length > 0) {
      const sourceSummaryMap = new Map<string, string>()
      for (const ra of regionalAnalyses) {
        for (const ss of ra.sourceSummaries) {
          sourceSummaryMap.set(ss.url, ss.summary)
        }
      }

      await tx.source.createMany({
        data: triageResult.sources.map((s: TriagedSource) => ({
          storyId: story.id,
          url: s.url,
          title: s.title,
          outlet: s.outlet,
          outletType: s.outletType,
          country: s.country,
          region: s.region,
          language: s.language,
          politicalLean: s.politicalLean,
          reliability: s.reliability,
          summary: sourceSummaryMap.get(s.url) ??
            (s.isWireCopy ? `[Wire copy. Original: ${s.originalSource || 'unknown'}]` : null),
          publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
        })),
      })
    }

    // Claims
    if (synthesisResult.claims.length > 0) {
      await tx.claim.createMany({
        data: synthesisResult.claims.map((c, i) => ({
          storyId: story.id,
          claim: c.claim,
          confidence: c.confidence,
          consensusPct: c.consensusPct,
          supportedBy: c.supportedBy,
          contradictedBy: c.contradictedBy,
          notes: c.notes ?? null,
          sortOrder: i,
        })),
      })
    }

    // Discrepancies
    if (synthesisResult.discrepancies.length > 0) {
      await tx.discrepancy.createMany({
        data: synthesisResult.discrepancies.map((d) => ({
          storyId: story.id,
          issue: d.issue,
          sideA: d.sideA,
          sideB: d.sideB,
          sourcesA: d.sourcesA,
          sourcesB: d.sourcesB,
          assessment: d.assessment ?? null,
        })),
      })
    }

    // Omissions
    if (synthesisResult.omissions.length > 0) {
      await tx.omission.createMany({
        data: synthesisResult.omissions.map((o) => ({
          storyId: story.id,
          outletRegion: o.outletRegion,
          missing: o.missing,
          presentIn: o.presentIn,
          significance: o.significance ?? null,
        })),
      })
    }

    // Framings
    if (synthesisResult.framings.length > 0) {
      await tx.framingAnalysis.createMany({
        data: synthesisResult.framings.map((f) => ({
          storyId: story.id,
          region: f.region,
          framing: f.framing,
          contrastWith: f.contrastWith ?? null,
        })),
      })
    }

    // Silences
    if (silenceAnalyses.length > 0) {
      await tx.regionalSilence.createMany({
        data: silenceAnalyses.map((s: SilenceAnalysis) => ({
          storyId: story.id,
          region: s.region,
          sourcesSearched: s.sourcesSearched,
          possibleReasons: s.possibleReasons,
          isSignificant: s.isSignificant,
        })),
      })
    }

    // Follow-up questions
    if (synthesisResult.followUpQuestions.length > 0) {
      await tx.followUpQuestion.createMany({
        data: synthesisResult.followUpQuestions.map((q, i) => ({
          storyId: story.id,
          question: q.question,
          sortOrder: i,
        })),
      })
    }

    // Debate rounds
    if (allDebateRounds.length > 0) {
      await tx.debateRound.createMany({
        data: allDebateRounds.map((d) => ({
          storyId: story.id,
          region: d.region,
          round: d.round,
          modelName: d.modelName,
          provider: d.provider,
          content: JSON.stringify(d.content),
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          costUsd: d.costUsd,
        })),
      })
    }

    return story
  })

  // Generate social drafts (outside transaction — failure shouldn't roll back the story)
  try {
    const drafts = await generateSocialDrafts({
      headline: synthesisResult.headline,
      synopsis: synthesisResult.synopsis,
      confidenceLevel: synthesisResult.confidenceLevel,
      consensusScore: synthesisResult.consensusScore,
      sourceCount: triageResult.sources.length,
      countryCount: countries.size,
      regionCount: regions.size,
      claims: synthesisResult.claims,
      discrepancies: synthesisResult.discrepancies,
      omissions: synthesisResult.omissions,
      framings: synthesisResult.framings,
    }, story.id)

    if (drafts.length > 0) {
      await prisma.socialDraft.createMany({
        data: drafts.map((d) => ({
          storyId: story.id,
          platform: d.platform,
          content: d.content,
          metadata: d.metadata ? JSON.stringify(d.metadata) : null,
          status: 'draft',
        })),
      })
    }
    onProgress('social', { phase: 'social', message: `Generated ${drafts.length} social drafts` })
  } catch (err) {
    console.error('Social draft generation failed:', err)
  }

  // ── STREAM 2: DISCOURSE ANALYSIS (social media only) ──────────────────
  // Completely separate from Stream 1. Reddit + Twitter/X feed the Discourse
  // Gap section. News outlets never enter this stream.
  try {
    // Use the same rich keyword set as RSS search (includes international variants)
    const discourseKeywords = queryToKeywords(query)

    const [redditPosts, twitterPosts] = await Promise.all([
      fetchRedditDiscourse(discourseKeywords, triageResult.suggestedCategory, 10, 50),
      fetchTwitterDiscourse(discourseKeywords, 10, 100),
    ])

    const allSocialPosts = [...redditPosts, ...twitterPosts]

    if (allSocialPosts.length > 0) {
      // Determine media dominant framing from synthesis (Stream 1 output)
      const mediaDominantFrame = synthesisResult.framingSplit?.[0]?.frameName || 'unknown'
      const mediaFramePct = synthesisResult.framingSplit?.[0]?.outletCount
        ? Math.round((synthesisResult.framingSplit[0].outletCount / triageResult.sources.length) * 100)
        : 0

      // Pass BOTH platforms to the discourse agent
      const discourseResult = await analyzeDiscourse(
        {
          headline: synthesisResult.headline,
          dominantFraming: mediaDominantFrame,
          framingPct: mediaFramePct,
          claims: synthesisResult.claims.map(c => c.claim).slice(0, 5),
        },
        allSocialPosts,
        story.id,
      )
      totalCost += discourseResult.costUsd

      // Save discourse snapshot (combined platform stats)
      const snapshot = await prisma.discourseSnapshot.create({
        data: {
          storyId: story.id,
          platform: 'combined',
          totalEngagement:
            redditPosts.reduce((n, p) => n + p.upvotes, 0) +
            twitterPosts.reduce((n, p) => n + p.likes + p.retweets, 0),
          postCount: allSocialPosts.length,
          dominantSentiment: discourseResult.aggregate.dominant_sentiment,
          dominantFraming: discourseResult.aggregate.dominant_framing,
        },
      })

      // Save Reddit posts with AI classifications
      if (redditPosts.length > 0) {
        await prisma.discoursePost.createMany({
          data: redditPosts.map((p, i) => {
            const analysis = discourseResult.posts.find(a => a.post_index === i)
            return {
              snapshotId: snapshot.id,
              platform: 'reddit',
              url: p.url,
              author: p.author,
              content: p.content.substring(0, 2000),
              subreddit: p.subreddit,
              upvotes: p.upvotes,
              comments: p.comments,
              framingType: analysis?.framing_type ?? null,
              sentiment: analysis?.sentiment ?? null,
              topComments: p.topComments.length > 0 ? JSON.stringify(p.topComments) : null,
              sortOrder: i,
            }
          }),
        })
      }

      // Save Twitter posts with AI classifications
      if (twitterPosts.length > 0) {
        await prisma.discoursePost.createMany({
          data: twitterPosts.map((p, i) => {
            const globalIndex = redditPosts.length + i
            const analysis = discourseResult.posts.find(a => a.post_index === globalIndex)
            return {
              snapshotId: snapshot.id,
              platform: 'twitter',
              url: p.url,
              author: p.author,
              authorFollowers: p.authorFollowers,
              isVerified: p.isVerified,
              content: p.content,
              hashtags: JSON.stringify(p.hashtags),
              upvotes: p.likes,
              comments: p.replies,
              shares: p.retweets,
              views: p.views,
              framingType: analysis?.framing_type ?? null,
              sentiment: analysis?.sentiment ?? null,
              sortOrder: globalIndex,
            }
          }),
        })
      }

      // Save discourse gap
      await prisma.discourseGap.create({
        data: {
          storyId: story.id,
          mediaDominantFrame: discourseResult.gap.media_dominant_frame,
          mediaFramePct: discourseResult.gap.media_frame_pct,
          publicDominantFrame: discourseResult.gap.public_dominant_frame,
          publicFramePct: discourseResult.gap.public_frame_pct,
          gapScore: discourseResult.gap.gap_score,
          gapDirection: discourseResult.gap.gap_direction,
          gapSummary: discourseResult.gap.gap_summary,
          publicSurfacedFirst: discourseResult.gap.public_surfaced_first.length > 0
            ? JSON.stringify(discourseResult.gap.public_surfaced_first) : null,
          mediaIgnoredByPublic: discourseResult.gap.media_ignored_by_public.length > 0
            ? JSON.stringify(discourseResult.gap.media_ignored_by_public) : null,
          publicCounterNarrative: discourseResult.gap.public_counter_narrative || null,
        },
      })

      onProgress('discourse', {
        phase: 'discourse',
        message: `Discourse gap: ${discourseResult.gap.gap_score}/100 (${discourseResult.gap.gap_direction}). ${redditPosts.length} Reddit + ${twitterPosts.length} Twitter/X posts analyzed.`,
      })
    } else {
      onProgress('discourse', {
        phase: 'discourse',
        message: 'No social discourse found for this story.',
      })
    }
  } catch (err) {
    console.error('Discourse analysis failed:', err)
  }

  // ── PIPELINE SUMMARY ──────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n[pipeline] ══════════════════════════════════════`)
  console.log(`[pipeline] Story: ${synthesisResult.headline}`)
  console.log(`[pipeline] Sources: ${triageResult.sources.length} triaged → ${fetchedCount} fetched`)
  console.log(`[pipeline] Countries: ${finalByCountry.size} | Regions: ${finalByRegion.size}`)
  console.log(`[pipeline] Debate: ${regionsWithSources.length} regions debated, ${regionsWithoutSources.length} silent`)
  console.log(`[pipeline] Cost: $${totalCost.toFixed(4)}`)
  console.log(`[pipeline] Time: ${elapsed}s`)
  console.log(`[pipeline] ══════════════════════════════════════\n`)

  onProgress('complete', {
    phase: 'complete',
    slug: story.slug,
    storyId: story.id,
  })

  return story.slug
}
