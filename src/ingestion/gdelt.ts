import { fetchWithTimeout } from '@/lib/utils'
import { fipsToIso } from '@/data/fips-to-iso'

export interface GdeltResult {
  url: string
  title: string
  seendate: string
  socialimage?: string
  domain: string
  language: string
  sourcecountry: string
}

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc'
const MAX_RECORDS = 75
const TIMESPAN = '14d'

/**
 * Get FIPS country codes that belong to a given region.
 */
function getFipsCodes(region: string): string[] {
  return Object.entries(fipsToIso)
    .filter(([, entry]) => entry.region === region)
    .map(([fips]) => fips)
}

/**
 * Extract broader keywords from a query string by removing common stop words.
 */
function extractKeywords(query: string): string {
  const stopWords = new Set([
    'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'and',
    'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'be',
    'been', 'being', 'with', 'from', 'by', 'about', 'between', 'its',
    'this', 'that', 'these', 'those', 'will', 'would', 'could', 'should',
  ])
  return query
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 5)
    .join(' ')
}

/**
 * Build a GDELT query URL.
 */
function buildUrl(query: string): string {
  const params = new URLSearchParams({
    query,
    mode: 'ArtList',
    maxrecords: String(MAX_RECORDS),
    format: 'json',
    sort: 'DateDesc',
    timespan: TIMESPAN,
  })
  return `${GDELT_BASE}?${params.toString()}`
}

/**
 * Fetch articles from GDELT for a single query string.
 */
async function fetchGdeltQuery(query: string): Promise<GdeltResult[]> {
  try {
    const url = buildUrl(query)
    const response = await fetchWithTimeout(url)
    if (!response.ok) return []

    const text = await response.text()

    // GDELT sometimes returns HTML error pages instead of JSON
    if (text.trimStart().startsWith('<')) return []

    const data = JSON.parse(text)
    const articles = data?.articles
    if (!Array.isArray(articles)) return []

    return articles.map((a: Record<string, unknown>) => ({
      url: String(a.url ?? ''),
      title: String(a.title ?? ''),
      seendate: String(a.seendate ?? ''),
      socialimage: a.socialimage ? String(a.socialimage) : undefined,
      domain: String(a.domain ?? ''),
      language: String(a.language ?? ''),
      sourcecountry: String(a.sourcecountry ?? ''),
    }))
  } catch {
    return []
  }
}

/**
 * Search GDELT with multiple query variations for maximum coverage.
 * Runs 4 variations:
 *   1. Exact query
 *   2. Query with region-specific terms (if region provided)
 *   3. Query with sourcecountry: filter for countries in the region
 *   4. Broader keywords extracted from query
 */
export async function searchGdelt(
  query: string,
  region?: string,
): Promise<GdeltResult[]> {
  const queries: string[] = []

  // Variation 1: Exact query
  queries.push(query)

  // Variation 2: Query with region context
  if (region) {
    queries.push(`${query} ${region}`)
  } else {
    // Without a region, duplicate exact query slot with a slightly different form
    queries.push(`"${query}"`)
  }

  // Variation 3: Query with sourcecountry filter
  if (region) {
    const fipsCodes = getFipsCodes(region)
    if (fipsCodes.length > 0) {
      // GDELT supports OR-ing sourcecountry codes
      const countryFilter = fipsCodes
        .slice(0, 5)
        .map((c) => `sourcecountry:${c}`)
        .join(' OR ')
      queries.push(`${query} (${countryFilter})`)
    }
  }

  // Variation 4: Broader keywords
  const keywords = extractKeywords(query)
  if (keywords && keywords !== query) {
    queries.push(keywords)
  }

  // Ensure exactly 4 queries
  while (queries.length < 4) {
    queries.push(query)
  }

  // Run all 4 queries in parallel
  const results = await Promise.all(
    queries.slice(0, 4).map((q) => fetchGdeltQuery(q)),
  )

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped: GdeltResult[] = []

  for (const batch of results) {
    for (const article of batch) {
      if (article.url && !seen.has(article.url)) {
        seen.add(article.url)
        deduped.push(article)
      }
    }
  }

  return deduped
}
