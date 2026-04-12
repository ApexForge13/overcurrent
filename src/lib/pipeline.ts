import { prisma } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { slugify, regionList } from '@/lib/utils'
import { searchGdeltGlobal, getRegionFromCountryName } from '@/ingestion/gdelt'
import { scanRssFeeds } from '@/ingestion/rss'
import { searchReddit } from '@/ingestion/reddit'
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

  // RSS is primary, GDELT is supplementary (best-effort with timeout)
  const [rssResults, redditResults] = await Promise.all([
    scanRssFeeds(query),
    searchReddit(query),
  ])

  // GDELT is best-effort — 15s timeout, don't block pipeline on it
  let allGdelt: Awaited<ReturnType<typeof searchGdeltGlobal>> = []
  try {
    allGdelt = await Promise.race([
      searchGdeltGlobal(query),
      new Promise<typeof allGdelt>((resolve) => setTimeout(() => resolve([]), 15_000)),
    ])
  } catch {
    // GDELT failed — continue with RSS + Reddit only
  }

  // Deduplicate by URL across all sources + limit per outlet
  const seenUrls = new Set<string>()
  const outletCounts = new Map<string, number>()
  const MAX_PER_OUTLET = 3 // Prevent one outlet dominating (Axios 19x problem)
  const rawSources: Array<{ url: string; title: string; domain: string; sourcecountry: string; knownRegion: string }> = []

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
      })
    }
  }

  // Add RSS results — use outlet registry for country/region, limit per outlet
  for (const rss of rssResults) {
    if (rss.url && !seenUrls.has(rss.url)) {
      // Per-outlet limit
      const outletKey = rss.outlet || 'unknown'
      const currentCount = outletCounts.get(outletKey) || 0
      if (currentCount >= MAX_PER_OUTLET) continue
      outletCounts.set(outletKey, currentCount + 1)

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
        })
      } catch {
        rawSources.push({ url: rss.url, title: rss.title, domain: '', sourcecountry: '', knownRegion: '' })
      }
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
        sourcecountry: 'United States',
        knownRegion: 'North America',
      })
    }
  }

  // Count unique countries and regions across ALL sources
  const countriesFound = new Set(rawSources.map((s) => s.sourcecountry).filter(Boolean))
  const regionsFound = new Set(
    rawSources
      .map((s) => getRegionFromCountryName(s.sourcecountry))
      .filter((r) => r !== 'Unknown'),
  )
  onProgress('search', {
    phase: 'search',
    message: `Found ${rawSources.length} sources across ${countriesFound.size} countries in ${regionsFound.size} regions`,
    sourceCount: rawSources.length,
    countryCount: countriesFound.size,
    regionCount: regionsFound.size,
  })

  // ── PHASE 2: TRIAGE ──────────────────────────────────────────────────

  const triageResult = await triageSources(rawSources, query)
  totalCost += triageResult.costUsd

  // Fallback: if triage returned 0 sources, use raw sources directly
  if (triageResult.sources.length === 0 && rawSources.length > 0) {
    const fallbackSources = rawSources.slice(0, 30).map((rs) => ({
      url: rs.url,
      title: rs.title,
      outlet: rs.domain,
      outletType: 'digital' as const,
      country: rs.sourcecountry ? rs.sourcecountry.substring(0, 2).toUpperCase() : 'US',
      region: rs.knownRegion || 'North America',
      language: 'en',
      politicalLean: 'unknown',
      reliability: 'unknown',
      isWireCopy: false,
      originalSource: null,
      citesSource: null,
    }))
    triageResult.sources = fallbackSources
    onProgress('triage', {
      phase: 'triage',
      message: `Triage returned 0 — using ${fallbackSources.length} raw sources as fallback`,
      sourceCount: fallbackSources.length,
    })
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

  let synthesisResult
  try {
    synthesisResult = await synthesize(
      query,
      regionalAnalyses,
      silenceAnalyses,
      triageResult.sources.length,
      countries.size,
      regions.size,
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
          propagationTimeline: synthesisResult.propagationTimeline,
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

  // ── DISCOURSE ANALYSIS (after social drafts) ──
  try {
    const keywords = query.split(/\s+/).filter(w => w.length > 3)
    const [redditPosts, twitterPosts] = await Promise.all([
      fetchRedditDiscourse(keywords, triageResult.suggestedCategory, 15, 50),
      fetchTwitterDiscourse(keywords),
    ])

    if (redditPosts.length > 0) {
      // Determine media dominant framing from synthesis
      const mediaDominantFrame = synthesisResult.framingSplit?.[0]?.frameName || 'unknown'
      const mediaFramePct = synthesisResult.framingSplit?.[0]?.outletCount
        ? Math.round((synthesisResult.framingSplit[0].outletCount / triageResult.sources.length) * 100)
        : 0

      const discourseResult = await analyzeDiscourse(
        {
          headline: synthesisResult.headline,
          dominantFraming: mediaDominantFrame,
          framingPct: mediaFramePct,
          claims: synthesisResult.claims.map(c => c.claim).slice(0, 5),
        },
        redditPosts,
        story.id,
      )
      totalCost += discourseResult.costUsd

      // Combine all social posts for discourse analysis
      const allSocialPosts = [...redditPosts, ...twitterPosts.map(t => ({
        ...t,
        upvotes: t.likes,
        comments: t.replies,
        subreddit: undefined,
        topComments: [] as Array<{text: string; upvotes: number}>,
        createdUtc: new Date(t.createdAt).getTime() / 1000,
      }))]

      // Save discourse snapshot
      const snapshot = await prisma.discourseSnapshot.create({
        data: {
          storyId: story.id,
          platform: 'reddit',
          totalEngagement: redditPosts.reduce((n, p) => n + p.upvotes, 0) + twitterPosts.reduce((n, p) => n + p.likes + p.retweets, 0),
          postCount: redditPosts.length + twitterPosts.length,
          dominantSentiment: discourseResult.aggregate.dominant_sentiment,
          dominantFraming: discourseResult.aggregate.dominant_framing,
        },
      })

      // Save discourse posts
      if (discourseResult.posts.length > 0) {
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

      // Save Twitter posts
      if (twitterPosts.length > 0) {
        await prisma.discoursePost.createMany({
          data: twitterPosts.map((p, i) => ({
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
            sortOrder: redditPosts.length + i,
          })),
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
        message: `Discourse gap: ${discourseResult.gap.gap_score}/100 (${discourseResult.gap.gap_direction}). ${redditPosts.length} Reddit + ${twitterPosts.length} Twitter posts analyzed.`,
      })
    } else {
      onProgress('discourse', {
        phase: 'discourse',
        message: 'No Reddit discourse found for this story.',
      })
    }
  } catch (err) {
    console.error('Discourse analysis failed:', err)
  }

  onProgress('complete', {
    phase: 'complete',
    slug: story.slug,
    storyId: story.id,
  })

  return story.slug
}
