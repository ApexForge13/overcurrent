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
    // Fix <rss> tags missing version attribute (News24, UOL) — rss-parser requires it
    .replace(/<rss(?=[>\s])(?![^>]*version)/i, '<rss version="2.0"')
    // Fix unencoded ampersands (but not already-encoded entities)
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    // Remove control characters (keep tab \x09, newline \x0A, carriage return \x0D)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Fix broken CDATA sections
    .replace(/]]>(?!<)/g, ']]&gt;')
}

/**
 * Keywords split into anchors (proper nouns, countries — MUST match at least one)
 * and context words (topic terms — MUST match at least one).
 * Both groups must have a hit for an article to be considered relevant.
 */
export interface SplitKeywords {
  anchors: string[]   // Proper nouns, countries, key entities
  context: string[]   // Topic/action words
  all: string[]       // Combined flat list (for non-English lenient matching)
}

/**
 * Known proper nouns / country names that act as topic anchors.
 * An article must mention at least one anchor AND one context word.
 */
const ANCHOR_WORDS = new Set([
  // Countries
  'iran', 'iraq', 'israel', 'palestine', 'gaza', 'lebanon', 'syria', 'yemen', 'jordan',
  'saudi', 'qatar', 'egypt', 'turkey', 'russia', 'ukraine', 'china', 'taiwan', 'japan',
  'korea', 'india', 'pakistan', 'afghanistan', 'honduras', 'mexico', 'brazil', 'venezuela',
  'colombia', 'cuba', 'argentina', 'chile', 'peru', 'nigeria', 'kenya', 'sudan', 'libya',
  'somalia', 'ethiopia', 'congo', 'myanmar', 'philippines', 'indonesia', 'vietnam',
  // Cities / regions
  'tehran', 'islamabad', 'jerusalem', 'kyiv', 'moscow', 'beijing', 'taipei', 'kabul',
  'baghdad', 'damascus', 'beirut', 'riyadh', 'doha', 'cairo', 'ankara', 'nairobi',
  // Key figures
  'trump', 'biden', 'putin', 'zelensky', 'netanyahu', 'khamenei', 'modi', 'erdogan',
  'vance', 'witkoff', 'kushner', 'araghchi', 'pezeshkian', 'sharif', 'jinping',
  // Organizations
  'nato', 'hamas', 'hezbollah', 'houthi', 'iaea', 'opec',
])

/**
 * Check if text matches the anchor+context keyword strategy.
 * Requires at least 1 anchor AND at least 1 context keyword to match.
 * Falls back to requiring 2+ keyword matches if no anchors defined.
 */
function matchesKeywordsStrict(text: string, kw: SplitKeywords): boolean {
  const lower = text.toLowerCase()

  if (kw.anchors.length > 0 && kw.context.length > 0) {
    const hasAnchor = kw.anchors.some(a => lower.includes(a))
    const hasContext = kw.context.some(c => lower.includes(c))
    return hasAnchor && hasContext
  }

  // Fallback: require at least 2 keywords from the full list
  let hits = 0
  for (const k of kw.all) {
    if (lower.includes(k)) {
      hits++
      if (hits >= 2) return true
    }
  }
  return false
}

/**
 * Lenient match for non-English outlets — any single keyword hit.
 */
function matchesKeywordsLenient(text: string, kw: SplitKeywords): boolean {
  const lower = text.toLowerCase()
  return kw.all.some(k => lower.includes(k))
}

/**
 * Extract keywords from a query string, split into anchors and context.
 * Also generates broader variants for international matching.
 */
export function queryToKeywords(query: string): SplitKeywords {
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
  if (words.includes('honduras')) extras.push('honduran', 'tegucigalpa', 'central america')
  if (words.includes('migrant')) extras.push('migration', 'immigrant', 'refugee', 'caravan', 'asylum')
  if (words.includes('blockade')) extras.push('embargo', 'naval', 'siege')

  const all = [...new Set([...words, ...extras])]
  const anchors = all.filter(w => ANCHOR_WORDS.has(w))
  const context = all.filter(w => !ANCHOR_WORDS.has(w))

  return { anchors, context, all }
}

/**
 * Fetch a single RSS feed and return matching articles.
 */
async function fetchFeed(
  outlet: OutletInfo,
  parser: { parseString: (xml: string) => Promise<{ items?: Array<{ title?: string; link?: string; contentSnippet?: string; content?: string; isoDate?: string; pubDate?: string }> }> },
  keywords: SplitKeywords,
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

    // Detect HTML response (redirect to homepage) — retry once for intermittent CDN issues
    if (xml.includes('<!DOCTYPE html') || (xml.includes('<html') && !xml.includes('<rss') && !xml.includes('<feed'))) {
      // Retry once — some CDN edges intermittently serve HTML
      const retry = await fetchWithTimeout(outlet.rssUrl!, RSS_TIMEOUT, { headers, redirect: 'follow' })
      if (retry.ok) {
        const retryXml = await retry.text()
        if (retryXml.includes('<rss') || retryXml.includes('<feed') || retryXml.includes('<?xml')) {
          xml = retryXml
        } else {
          console.warn(`[rss] ${outlet.name}: got HTML instead of XML (likely redirect)`)
          return []
        }
      } else {
        console.warn(`[rss] ${outlet.name}: got HTML instead of XML (likely redirect)`)
        return []
      }
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

    // Detect Google News RSS proxy feeds
    const isGoogleNewsProxy = outlet.rssUrl?.includes('news.google.com/rss/')

    // For non-English outlets, be more lenient — include recent articles
    // even if keyword match is weak
    const isEnglishOutlet = outlet.language === 'en'

    for (const item of items) {
      // Per-item try/catch — one bad item shouldn't kill the whole feed
      try {
        let title = item.title ?? ''
        let articleUrl = item.link ?? ''
        const snippet = item.contentSnippet ?? item.content ?? ''

        // Google News RSS: strip " - OutletName" from title, fix URL
        if (isGoogleNewsProxy) {
          // Title format: "Article Title - Outlet Name"
          title = title.replace(/\s*-\s*[^-]+$/, '')
          // Google News URLs are opaque redirects — construct searchable URL
          // Use the outlet domain + slugified title for dedup, article fetcher
          // will attempt to fetch this and fall back to snippet if it fails
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)
          articleUrl = `https://${outlet.domain}/${slug}`
        }

        const searchText = `${title} ${snippet}`

        // RSS is the discovery layer — cast a wide net, let triage filter.
        // Match if ANY keyword (4+ chars) appears in title or snippet.
        if (matchesKeywordsLenient(searchText, keywords)) {
          matched.push({
            url: articleUrl,
            title,
            outlet: outlet.name,
            publishedAt: item.isoDate ?? item.pubDate ?? '',
            snippet: snippet ? snippet.slice(0, 3000) : undefined,
            region: outlet.region,
            country: outlet.country,
          })
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
  keywords: SplitKeywords,
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
  if (keywords.all.length === 0) return []

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
    const searchQuery = keywords.all.slice(0, 5).join(' ')

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
