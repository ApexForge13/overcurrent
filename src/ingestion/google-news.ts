import { fetchWithTimeout, sleep } from '@/lib/utils'

export interface GoogleNewsResult {
  url: string
  title: string
  domain: string          // extracted from the resolved URL or source tag
  sourcecountry: string   // empty — Google News doesn't provide this
  publishedAt: string     // ISO date from pubDate
  source: string          // outlet name from Google News
}

/**
 * Resolve an opaque Google News redirect URL to the actual article URL.
 * Google News RSS links look like: https://news.google.com/rss/articles/CBMi...
 * A HEAD request with redirect:'manual' returns the real URL in the Location header.
 * Falls back to the original URL if resolution fails.
 */
async function resolveGoogleNewsUrl(url: string): Promise<string> {
  if (!url.includes('news.google.com')) return url
  try {
    const resp = await fetchWithTimeout(url, 8000, {
      method: 'HEAD',
      redirect: 'manual',
      headers: GNEWS_HEADERS,
    })
    const location = resp.headers.get('location')
    if (location && !location.includes('news.google.com')) {
      return location
    }
    // Some Google News redirects return 200 with a meta-refresh or JS redirect.
    // In that case, try a GET and look for the canonical URL in the HTML.
    if (resp.status === 200) {
      const getResp = await fetchWithTimeout(url, 8000, {
        headers: GNEWS_HEADERS,
      })
      const html = await getResp.text()
      // Look for <a href="https://..." data-n-au="..." > or similar redirect patterns
      const canonical = html.match(/data-n-au="([^"]+)"/)?.[1]
        || html.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"&]+)"/i)?.[1]
      if (canonical && !canonical.includes('news.google.com')) {
        return canonical
      }
    }
    return url
  } catch (err) {
    console.warn(`[Google News] Failed to resolve redirect for ${url.substring(0, 60)}...`)
    return url
  }
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

    const rawResults: GoogleNewsResult[] = []
    for (const itemXml of items) {
      if (rawResults.length >= maxResults) break
      const parsed = parseItem(itemXml)
      if (parsed) {
        rawResults.push(parsed)
      }
    }

    // Resolve any opaque Google News redirect URLs in parallel (batches of 5)
    const needsResolve = rawResults.filter(r => r.url.includes('news.google.com'))
    if (needsResolve.length > 0) {
      console.log(`[Google News] ${feed.lang}: Resolving ${needsResolve.length} redirect URLs...`)
      const BATCH = 5
      for (let b = 0; b < needsResolve.length; b += BATCH) {
        const batch = needsResolve.slice(b, b + BATCH)
        const resolved = await Promise.all(batch.map(r => resolveGoogleNewsUrl(r.url)))
        for (let k = 0; k < batch.length; k++) {
          const newUrl = resolved[k]
          if (newUrl !== batch[k].url) {
            batch[k].url = newUrl
            // Update domain from the resolved URL
            try {
              batch[k].domain = new URL(newUrl).hostname.replace('www.', '')
            } catch { /* keep original domain */ }
          }
        }
      }
      const resolvedCount = needsResolve.filter(r => !r.url.includes('news.google.com')).length
      console.log(`[Google News] ${feed.lang}: Resolved ${resolvedCount}/${needsResolve.length} redirects`)
    }

    // Drop any results that are still opaque Google News URLs (unresolvable)
    const results = rawResults.filter(r => !r.url.includes('news.google.com'))

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
