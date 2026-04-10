import Parser from 'rss-parser'
import { fetchWithTimeout } from '@/lib/utils'
import { getOutletsWithRss, getOutletsForRegion } from '@/data/outlets'

export interface RssResult {
  url: string
  title: string
  outlet: string
  publishedAt: string
  snippet?: string
}

const RSS_TIMEOUT = 15_000

/**
 * Check if a string contains any of the given keywords (case-insensitive).
 */
function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw))
}

/**
 * Extract keywords from a query string for matching.
 */
function queryToKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
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
    ? getOutletsForRegion(region)
    : getOutletsWithRss()

  if (outlets.length === 0) return []

  const keywords = queryToKeywords(query)
  if (keywords.length === 0) return []

  const parser = new Parser()
  const results: RssResult[] = []

  const feedPromises = outlets.map(async (outlet) => {
    if (!outlet.rssUrl) return []

    try {
      // Fetch the raw XML with timeout
      const response = await fetchWithTimeout(outlet.rssUrl, RSS_TIMEOUT)
      if (!response.ok) return []

      const xml = await response.text()
      const feed = await parser.parseString(xml)

      const matched: RssResult[] = []

      for (const item of feed.items ?? []) {
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
          })
        }
      }

      return matched
    } catch (err) {
      console.warn(`[RSS] Failed to fetch feed for ${outlet.name}:`, err)
      return []
    }
  })

  const feedResults = await Promise.all(feedPromises)
  for (const batch of feedResults) {
    results.push(...batch)
  }

  return results
}
