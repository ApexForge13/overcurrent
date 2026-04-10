import { prisma } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { slugify, regionList } from '@/lib/utils'
import { searchGdelt } from '@/ingestion/gdelt'
import { scanRssFeeds } from '@/ingestion/rss'
import { searchReddit } from '@/ingestion/reddit'
import { fetchArticle } from '@/ingestion/article-fetcher'
import { triageSources } from '@/agents/triage'
import { analyzeRegion } from '@/agents/regional'
import { analyzeSilence } from '@/agents/silence'
import { synthesize } from '@/agents/synthesis'
import type { TriagedSource } from '@/agents/triage'
import type { RegionalAnalysis } from '@/agents/regional'
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

  // Search GDELT across all 6 regions in parallel, plus RSS + Reddit
  const [gdeltResults, rssResults, redditResults] = await Promise.all([
    Promise.all(regionList.map((region) => searchGdelt(query, region))),
    scanRssFeeds(query),
    searchReddit(query),
  ])

  // Merge all GDELT results
  const allGdelt = gdeltResults.flat()

  // Deduplicate by URL across all sources
  const seenUrls = new Set<string>()
  const rawSources: Array<{ url: string; title: string; domain: string; sourcecountry: string }> = []

  for (const article of allGdelt) {
    if (article.url && !seenUrls.has(article.url)) {
      seenUrls.add(article.url)
      rawSources.push({
        url: article.url,
        title: article.title,
        domain: article.domain,
        sourcecountry: article.sourcecountry,
      })
    }
  }

  // Add RSS results
  for (const rss of rssResults) {
    if (rss.url && !seenUrls.has(rss.url)) {
      seenUrls.add(rss.url)
      rawSources.push({
        url: rss.url,
        title: rss.title,
        domain: new URL(rss.url).hostname,
        sourcecountry: '',
      })
    }
  }

  // Add Reddit results
  for (const reddit of redditResults) {
    if (reddit.url && !seenUrls.has(reddit.url)) {
      seenUrls.add(reddit.url)
      rawSources.push({
        url: reddit.url,
        title: reddit.title,
        domain: 'reddit.com',
        sourcecountry: '',
      })
    }
  }

  // Count unique countries that have results
  const countriesFound = new Set(allGdelt.map((a) => a.sourcecountry).filter(Boolean)).size
  onProgress('search', {
    phase: 'search',
    message: `Found ${rawSources.length} sources across ${countriesFound} countries`,
    sourceCount: rawSources.length,
  })

  // ── PHASE 2: TRIAGE ──────────────────────────────────────────────────

  const triageResult = await triageSources(rawSources, query)
  totalCost += triageResult.costUsd

  onProgress('triage', {
    phase: 'triage',
    message: `Triaged ${triageResult.sources.length} unique sources`,
    sourceCount: triageResult.sources.length,
  })

  // ── PHASE 3: FETCH ───────────────────────────────────────────────────

  const topSources = triageResult.sources.slice(0, 30)
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

  // Run regional + silence analyses in parallel
  const [regionalAnalyses, silenceAnalyses] = await Promise.all([
    Promise.all(
      regionsWithSources.map(async (region) => {
        const sources = sourcesByRegion.get(region)!
        const result = await analyzeRegion(region, sources, query, allRegionsSummary)
        totalCost += result.costUsd
        onProgress('analysis', {
          phase: 'analysis',
          message: `Analyzed ${region}`,
          region,
          type: 'regional',
        })
        return result
      }),
    ),
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

  // ── PHASE 5: SYNTHESIS ───────────────────────────────────────────────

  onProgress('synthesis', {
    phase: 'synthesis',
    message: 'Generating final report',
  })

  const countries = new Set(triageResult.sources.map((s: TriagedSource) => s.country))
  const regions = new Set(triageResult.sources.map((s: TriagedSource) => s.region))

  const synthesisResult = await synthesize(
    query,
    regionalAnalyses,
    silenceAnalyses,
    triageResult.sources.length,
    countries.size,
    regions.size,
  )
  totalCost += synthesisResult.costUsd

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
        headline: synthesisResult.headline,
        synopsis: synthesisResult.synopsis,
        confidenceLevel: synthesisResult.confidenceLevel,
        confidenceNote: synthesisResult.confidenceNote,
        category: triageResult.suggestedCategory,
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
          summary: sourceSummaryMap.get(s.url) ?? null,
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
          question: q,
          sortOrder: i,
        })),
      })
    }

    return story
  })

  onProgress('complete', {
    phase: 'complete',
    slug: story.slug,
    storyId: story.id,
  })

  return story.slug
}
