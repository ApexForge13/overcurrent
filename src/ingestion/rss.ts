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

// Browser User-Agent — many state media sites (PressTV, RT) block bot-looking requests
const RSS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
}

// Per-outlet header overrides for sites that block generic requests
const OUTLET_HEADER_OVERRIDES: Record<string, Record<string, string>> = {
  'presstv.ir': { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.google.com/' },
  'farsnews.ir': { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.google.com/' },
  'tasnimnews.com': { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.google.com/' },
  'rt.com': { 'Accept-Language': 'en-US,en;q=0.9' },
  'tass.com': { 'Accept-Language': 'en-US,en;q=0.9' },
  'globaltimes.cn': { 'Accept-Language': 'en-US,en;q=0.9' },
}

/**
 * Sanitize malformed XML that breaks rss-parser.
 * Common issues: unencoded ampersands, control chars, broken CDATA.
 */
function sanitizeXml(xml: string): string {
  return xml
    // Fix unencoded ampersands (but not already-encoded entities)
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    // Remove control characters (keep tab \x09, newline \x0A, carriage return \x0D)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Fix broken CDATA sections
    .replace(/]]>(?!<)/g, ']]&gt;')
}

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
    // Merge base headers with per-outlet overrides
    const domain = outlet.domain.replace(/^www\./, '')
    const overrides = OUTLET_HEADER_OVERRIDES[domain] ?? {}
    const headers = { ...RSS_HEADERS, ...overrides }

    const response = await fetchWithTimeout(outlet.rssUrl, RSS_TIMEOUT, {
      headers,
      redirect: 'follow',
    })
    if (!response.ok) {
      console.warn(`[rss] ${outlet.name} (${outlet.country}/${outlet.region}): HTTP ${response.status}`)
      return []
    }

    let xml = await response.text()

    // Detect HTML response (redirect to homepage)
    if (xml.includes('<!DOCTYPE html') || (xml.includes('<html') && !xml.includes('<rss') && !xml.includes('<feed'))) {
      console.warn(`[rss] ${outlet.name}: got HTML instead of XML (likely redirect)`)
      return []
    }

    // Try parsing raw XML first, fall back to sanitized version
    let feed: { items?: Array<{ title?: string; link?: string; contentSnippet?: string; content?: string; isoDate?: string; pubDate?: string }> }
    try {
      feed = await parser.parseString(xml)
    } catch {
      // Sanitize and retry
      xml = sanitizeXml(xml)
      try {
        feed = await parser.parseString(xml)
      } catch (parseErr) {
        console.warn(`[rss] ${outlet.name}: XML parse failed even after sanitization: ${parseErr instanceof Error ? parseErr.message : parseErr}`)
        return []
      }
    }

    const matched: RssResult[] = []
    const items = feed.items ?? []

    // For non-English outlets, be more lenient — include recent articles
    // even if keyword match is weak
    const isEnglishOutlet = outlet.language === 'en'

    for (const item of items) {
      // Per-item try/catch — one bad item shouldn't kill the whole feed
      try {
        const title = item.title ?? ''
        const snippet = item.contentSnippet ?? item.content ?? ''
        const searchText = `${title} ${snippet}`

        if (matchesKeywords(searchText, keywords)) {
          matched.push({
            url: item.link ?? '',
            title,
            outlet: outlet.name,
            publishedAt: item.isoDate ?? item.pubDate ?? '',
            snippet: snippet ? snippet.slice(0, 3000) : undefined,
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
                snippet: snippet ? snippet.slice(0, 3000) : undefined,
                region: outlet.region,
                country: outlet.country,
              })
            }
          }
        }
      } catch {
        // Skip malformed item, continue with rest
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

  // ── WEB SEARCH FALLBACK for high-priority outlets without RSS ────────
  // State media outlets that block RSS or are unreachable from US IPs.
  // Search Google for their recent articles matching story keywords.
  const HIGH_PRIORITY_DOMAINS = [
    'presstv.ir', 'tasnimnews.com', 'farsnews.ir',     // Iran
    'trtworld.com', 'aa.com.tr',                         // Turkey
    'rt.com', 'tass.com',                                // Russia
    'globaltimes.cn', 'cgtn.com', 'xinhuanet.com',       // China
  ]

  // Check which high-priority outlets got zero results from RSS
  const outletDomainsWithResults = new Set(results.map(r => {
    try { return new URL(r.url).hostname.replace(/^www\./, '') } catch { return '' }
  }))
  const missingHighPriority = HIGH_PRIORITY_DOMAINS.filter(d => !outletDomainsWithResults.has(d))

  if (missingHighPriority.length > 0) {
    console.log(`[RSS] Missing high-priority outlets, attempting web search fallback: ${missingHighPriority.join(', ')}`)
    const searchQuery = keywords.slice(0, 5).join(' ')

    for (const domain of missingHighPriority.slice(0, 5)) { // Cap at 5 to avoid rate limits
      try {
        const searchUrl = `https://www.google.com/search?q=site:${domain}+${encodeURIComponent(searchQuery)}&tbs=qdr:w&num=3`
        const resp = await fetchWithTimeout(searchUrl, 8000, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        })
        if (!resp.ok) continue
        const html = await resp.text()

        // Extract URLs from Google search results (href="/url?q=..." pattern)
        const urlMatches = html.matchAll(/\/url\?q=(https?:\/\/[^&"]+)/g)
        const outletInfo = outlets.find(o => o.domain.includes(domain.replace(/^www\./, '')))

        let count = 0
        for (const match of urlMatches) {
          const articleUrl = decodeURIComponent(match[1])
          if (!articleUrl.includes(domain)) continue
          if (count >= 3) break

          results.push({
            url: articleUrl,
            title: `[${outletInfo?.name ?? domain}] ${searchQuery}`,
            outlet: outletInfo?.name ?? domain,
            publishedAt: new Date().toISOString(), // Approximate — recent
            region: outletInfo?.region,
            country: outletInfo?.country,
          })
          count++
        }

        if (count > 0) {
          console.log(`[RSS] Web search fallback: found ${count} articles from ${domain}`)
        }
      } catch {
        // Skip search failures silently
      }
    }
  }

  return results
}
