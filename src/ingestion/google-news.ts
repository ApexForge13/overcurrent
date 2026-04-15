import { fetchWithTimeout, sleep } from '@/lib/utils'

export interface GoogleNewsResult {
  url: string
  title: string
  domain: string          // extracted from the resolved URL or source tag
  sourcecountry: string   // empty — Google News doesn't provide this
  publishedAt: string     // ISO date from pubDate
  source: string          // outlet name from Google News
}

interface LanguageFeed {
  lang: string
  hl: string
  gl: string
  ceid: string
}

const LANGUAGE_FEEDS: LanguageFeed[] = [
  { lang: 'en', hl: 'en', gl: 'US', ceid: 'US:en' },
  { lang: 'es', hl: 'es', gl: 'MX', ceid: 'MX:es' },
  { lang: 'fr', hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
  { lang: 'ar', hl: 'ar', gl: 'SA', ceid: 'SA:ar' },
  { lang: 'pt', hl: 'pt', gl: 'BR', ceid: 'BR:pt' },
  { lang: 'hi', hl: 'hi', gl: 'IN', ceid: 'IN:hi' },
]

const GNEWS_TIMEOUT = 15_000

const GNEWS_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
}

/**
 * Parse a single `<item>` block from Google News RSS XML.
 */
function parseItem(item: string): GoogleNewsResult | null {
  try {
    const title =
      item
        .match(/<title>(.*?)<\/title>/)?.[1]
        ?.replace(/<!\[CDATA\[(.*?)\]\]>/, '$1') || ''
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || ''
    const source = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || ''
    const sourceUrl = item.match(/<source\s+url="([^"]*)">/)?.[1] || ''
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || ''

    if (!link && !sourceUrl) return null

    // Extract domain from the source URL first, fall back to link
    let domain = ''
    try {
      domain = new URL(sourceUrl || link).hostname.replace('www.', '')
    } catch {
      // If both URLs are malformed, skip
      return null
    }

    // Convert pubDate to ISO string
    let publishedAt = ''
    if (pubDate) {
      try {
        publishedAt = new Date(pubDate).toISOString()
      } catch {
        publishedAt = pubDate
      }
    }

    // Prefer sourceUrl (actual article) over link (opaque Google News redirect)
    const resolvedUrl = sourceUrl && !sourceUrl.includes('news.google.com') ? sourceUrl : link

    return {
      url: resolvedUrl,
      title,
      domain,
      sourcecountry: '', // Google News doesn't provide this
      publishedAt,
      source,
    }
  } catch {
    return null
  }
}

/**
 * Fetch a single Google News RSS feed for a given language.
 * Returns the parsed results and the language tag.
 */
async function fetchLanguageFeed(
  anchors: string[],
  feed: LanguageFeed,
  maxResults: number,
): Promise<{ lang: string; results: GoogleNewsResult[] }> {
  const queryString = anchors.slice(0, 5).join('+')
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(queryString)}&hl=${feed.hl}&gl=${feed.gl}&ceid=${feed.ceid}`

  try {
    const response = await fetchWithTimeout(url, GNEWS_TIMEOUT, {
      headers: GNEWS_HEADERS,
    })

    if (!response.ok) {
      console.warn(
        `[Google News] ${feed.lang}: HTTP ${response.status}`,
      )
      return { lang: feed.lang, results: [] }
    }

    const xml = await response.text()

    // Extract <item> blocks with simple regex (Google News RSS is well-formed)
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || []

    const results: GoogleNewsResult[] = []
    for (const itemXml of items) {
      if (results.length >= maxResults) break
      const parsed = parseItem(itemXml)
      if (parsed) {
        results.push(parsed)
      }
    }

    return { lang: feed.lang, results }
  } catch (err) {
    console.warn(
      `[Google News] ${feed.lang}: ${err instanceof Error ? err.message : 'fetch failed'}`,
    )
    return { lang: feed.lang, results: [] }
  }
}

/**
 * Fetch Google News RSS feeds across 6 languages in parallel.
 *
 * Uses anchor keywords (entity names / proper nouns) which work well
 * across languages — "Iran", "Trump", "NATO" are recognisable in most scripts.
 *
 * @param query   - Full query string (unused directly, kept for interface consistency)
 * @param anchors - Anchor keywords (proper nouns, countries, entities)
 * @param maxPerLanguage - Max results per language feed (default 30)
 */
export async function fetchGoogleNewsResults(
  query: string,
  anchors: string[],
  maxPerLanguage: number = 30,
): Promise<GoogleNewsResult[]> {
  if (anchors.length === 0) {
    console.warn('[Google News] No anchors provided, skipping')
    return []
  }

  // Fetch all 6 language feeds in parallel, with a small stagger
  // to avoid hammering Google News simultaneously
  const feedPromises: Promise<{ lang: string; results: GoogleNewsResult[] }>[] = []

  for (let i = 0; i < LANGUAGE_FEEDS.length; i++) {
    const feed = LANGUAGE_FEEDS[i]
    // Stagger fetches: first fires immediately, then 1s apart
    const delayMs = i * 1000
    feedPromises.push(
      sleep(delayMs).then(() =>
        fetchLanguageFeed(anchors, feed, maxPerLanguage),
      ),
    )
  }

  const feedResults = await Promise.all(feedPromises)

  // Collect per-language counts for logging
  const langCounts: Record<string, number> = {}
  const allResults: GoogleNewsResult[] = []

  for (const { lang, results } of feedResults) {
    langCounts[lang] = results.length
    allResults.push(...results)
  }

  // Deduplicate by URL across all languages
  const seen = new Set<string>()
  const deduped: GoogleNewsResult[] = []

  for (const result of allResults) {
    if (!seen.has(result.url)) {
      seen.add(result.url)
      deduped.push(result)
    }
  }

  // Count how many languages returned at least one result
  const activeLangs = Object.values(langCounts).filter((c) => c > 0).length

  const countBreakdown = Object.entries(langCounts)
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(', ')

  console.log(
    `[Google News] Fetched ${deduped.length} unique sources across ${activeLangs} languages (${countBreakdown})`,
  )

  return deduped
}
