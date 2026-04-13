import { fetchWithTimeout } from '@/lib/utils'
import { getOutletsWithRss, getOutletsForRegion, OutletInfo } from '@/data/outlets'

export interface RssResult {
  url: string
  title: string
  outlet: string
  publishedAt: string
  snippet?: string
  region?: string
  country?: string
}

const RSS_TIMEOUT = 12_000
const MAX_CONCURRENT = 30 // Limit concurrent feed fetches to avoid Vercel connection limits

/**
 * Check if a string contains any of the given keywords (case-insensitive).
 */
function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw))
}

/**
 * Extract keywords from a query string for matching.
 * Also generates broader variants for international matching.
 */
export function queryToKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)

  // Add common international variations
  const extras: string[] = []
  if (words.includes('iran')) extras.push('tehran', 'iranian', 'araghchi', 'pezeshkian')
  if (words.includes('pakistan')) extras.push('islamabad', 'pakistani', 'sharif')
  if (words.includes('ceasefire')) extras.push('peace', 'talks', 'negotiations', 'truce', 'diplomacy', 'diplomatic')
  if (words.includes('negotiations')) extras.push('talks', 'diplomacy', 'diplomatic', 'deal')
  if (words.includes('trump')) extras.push('vance', 'witkoff', 'kushner')
  if (words.includes('war')) extras.push('conflict', 'military', 'strike', 'attack')

  return [...new Set([...words, ...extras])]
}

/**
 * Fetch a single RSS feed and return matching articles.
 */
async function fetchFeed(
  outlet: OutletInfo,
  parser: { parseString: (xml: string) => Promise<{ items?: Array<{ title?: string; link?: string; contentSnippet?: string; content?: string; isoDate?: string; pubDate?: string }> }> },
  keywords: string[],
): Promise<RssResult[]> {
  if (!outlet.rssUrl) return []

  try {
    const response = await fetchWithTimeout(outlet.rssUrl, RSS_TIMEOUT)
    if (!response.ok) {
      console.warn(`[rss] ${outlet.name} (${outlet.country}/${outlet.region}): HTTP ${response.status}`)
      return []
    }

    const xml = await response.text()
    const feed = await parser.parseString(xml)

    const matched: RssResult[] = []
    const items = feed.items ?? []

    // For non-English outlets, be more lenient — include recent articles
    // even if keyword match is weak
    const isEnglishOutlet = outlet.language === 'en'

    for (const item of items) {
      const title = item.title ?? ''
      const snippet = item.contentSnippet ?? item.content ?? ''
      const searchText = `${title} ${snippet}`

      if (matchesKeywords(searchText, keywords)) {
        matched.push({
          url: item.link ?? '',
          title,
          outlet: outlet.name,
          publishedAt: item.isoDate ?? item.pubDate ?? '',
          snippet: snippet ? snippet.slice(0, 300) : undefined,
          region: outlet.region,
          country: outlet.country,
        })
      } else if (!isEnglishOutlet) {
        // For non-English outlets, include ANY recent article from feeds
        // that cover international news — the triage agent will filter
        const pubDate = item.isoDate || item.pubDate
        if (pubDate) {
          const age = Date.now() - new Date(pubDate).getTime()
          const hoursOld = age / (1000 * 60 * 60)
          if (hoursOld < 72) {
            matched.push({
              url: item.link ?? '',
              title,
              outlet: outlet.name,
              publishedAt: pubDate,
              snippet: snippet ? snippet.slice(0, 300) : undefined,
              region: outlet.region,
              country: outlet.country,
            })
          }
        }
      }
    }

    return matched
  } catch (err) {
    console.warn(`[rss] ${outlet.name} (${outlet.country}/${outlet.region}): ${err instanceof Error ? err.message : 'fetch failed'}`)
    return []
  }
}

/**
 * Run feeds in batches to avoid overwhelming Vercel's connection limits.
 */
interface FeedDiagnostics {
  total: number
  success: number
  failed: number
  empty: number
  byRegion: Record<string, { queried: number; returned: number }>
}

async function batchFetchFeeds(
  outlets: OutletInfo[],
  parser: { parseString: (xml: string) => Promise<{ items?: Array<{ title?: string; link?: string; contentSnippet?: string; content?: string; isoDate?: string; pubDate?: string }> }> },
  keywords: string[],
): Promise<{ results: RssResult[]; diagnostics: FeedDiagnostics }> {
  const allResults: RssResult[] = []
  const diagnostics: FeedDiagnostics = { total: outlets.length, success: 0, failed: 0, empty: 0, byRegion: {} }

  for (let i = 0; i < outlets.length; i += MAX_CONCURRENT) {
    const batch = outlets.slice(i, i + MAX_CONCURRENT)
    const batchResults = await Promise.all(
      batch.map(async (outlet) => {
        const region = outlet.region || 'Unknown'
        if (!diagnostics.byRegion[region]) diagnostics.byRegion[region] = { queried: 0, returned: 0 }
        diagnostics.byRegion[region].queried++

        const results = await fetchFeed(outlet, parser, keywords)
        if (results.length > 0) {
          diagnostics.success++
          diagnostics.byRegion[region].returned += results.length
        } else {
          diagnostics.empty++
        }
        return results
      })
    )
    for (const results of batchResults) {
      allResults.push(...results)
    }
  }

  return { results: allResults, diagnostics }
}

/**
 * Scan RSS feeds from known outlets and return items matching the query.
 * Filters by region if provided, otherwise uses all outlets with RSS feeds.
 */
export async function scanRssFeeds(
  query: string,
  region?: string,
): Promise<RssResult[]> {
  const outlets = region
    ? getOutletsForRegion(region).filter(o => !!o.rssUrl)
    : getOutletsWithRss()

  if (outlets.length === 0) return []

  const keywords = queryToKeywords(query)
  if (keywords.length === 0) return []

  let ParserClass: new () => { parseString: (xml: string) => Promise<{ items?: Array<{ title?: string; link?: string; contentSnippet?: string; content?: string; isoDate?: string; pubDate?: string }> }> }
  try {
    const mod = await import('rss-parser')
    ParserClass = mod.default
  } catch {
    console.warn('[RSS] rss-parser not available in this runtime, skipping RSS feeds')
    return []
  }
  const parser = new ParserClass()

  // Fetch feeds in batches of MAX_CONCURRENT
  const { results, diagnostics } = await batchFetchFeeds(outlets, parser, keywords)

  console.log(`[RSS] Scanned ${diagnostics.total} feeds. ${diagnostics.success} returned results, ${diagnostics.empty} empty. ${results.length} total articles.`)
  console.log(`[RSS] By region:`, JSON.stringify(diagnostics.byRegion))

  return results
}
