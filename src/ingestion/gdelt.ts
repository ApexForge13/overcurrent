import { fetchWithTimeout, sleep } from '@/lib/utils'
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
const REQUEST_DELAY_MS = 5500 // GDELT rate limit: 1 request per 5 seconds

/**
 * Quote words containing hyphens for GDELT.
 * GDELT rejects bare hyphens — "F-15" must be sent as `"F-15"`.
 */
function sanitizeQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((word) => {
      if (word.includes('-') && !word.startsWith('"')) {
        return `"${word}"`
      }
      return word
    })
    .join(' ')
}

/**
 * Get FIPS country codes that belong to a given region.
 */
function getFipsCodes(region: string): string[] {
  return Object.entries(fipsToIso)
    .filter(([, entry]) => entry.region === region)
    .map(([fips]) => fips)
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

    // GDELT returns plain text errors (not HTML, not JSON) for various issues
    if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
      return []
    }

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
 * Run GDELT queries sequentially with rate-limit delays.
 * Returns deduplicated results across all queries.
 */
async function runSequentialQueries(queries: string[]): Promise<GdeltResult[]> {
  const seen = new Set<string>()
  const all: GdeltResult[] = []

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(REQUEST_DELAY_MS)
    const results = await fetchGdeltQuery(queries[i])
    for (const article of results) {
      if (article.url && !seen.has(article.url)) {
        seen.add(article.url)
        all.push(article)
      }
    }
  }

  return all
}

/**
 * Search GDELT globally with smart query strategy.
 *
 * Instead of 4 variations × 6 regions (24 requests!), we run a focused set:
 *   - 1 broad global query (no region filter)
 *   - 1 query per region with sourcecountry filter (6 queries)
 *   = 7 total, run sequentially with rate-limit delays (~40s)
 *
 * If called WITHOUT a region, runs just 2 queries (global + keywords).
 * If called WITH a region, runs 1 query with sourcecountry filter.
 */
export async function searchGdelt(
  query: string,
  region?: string,
): Promise<GdeltResult[]> {
  const safeQuery = sanitizeQuery(query)

  if (!region) {
    // Global search: 2 queries
    return runSequentialQueries([
      safeQuery,
      `${safeQuery} sourcelang:english`,
    ])
  }

  // Region-specific search: 1 query with sourcecountry filter
  const fipsCodes = getFipsCodes(region)
  if (fipsCodes.length === 0) {
    return fetchGdeltQuery(safeQuery)
  }

  const countryFilter = fipsCodes
    .slice(0, 5)
    .map((c) => `sourcecountry:${c}`)
    .join(' OR ')

  return fetchGdeltQuery(`${safeQuery} (${countryFilter})`)
}

/**
 * Search GDELT across all regions efficiently.
 * Runs queries sequentially to respect rate limits.
 * Returns all results with proper sourcecountry fields.
 */
export async function searchGdeltAllRegions(
  query: string,
  regions: string[],
  onRegionDone?: (region: string, count: number) => void,
): Promise<GdeltResult[]> {
  const safeQuery = sanitizeQuery(query)
  const seen = new Set<string>()
  const all: GdeltResult[] = []

  function addResults(results: GdeltResult[]) {
    for (const article of results) {
      if (article.url && !seen.has(article.url)) {
        seen.add(article.url)
        all.push(article)
      }
    }
  }

  // Query 1: Global broad search
  const globalResults = await fetchGdeltQuery(safeQuery)
  addResults(globalResults)

  // Query 2-7: One per region with sourcecountry filter
  for (const region of regions) {
    await sleep(REQUEST_DELAY_MS)

    const fipsCodes = getFipsCodes(region)
    if (fipsCodes.length === 0) continue

    const countryFilter = fipsCodes
      .slice(0, 5)
      .map((c) => `sourcecountry:${c}`)
      .join(' OR ')

    const regionResults = await fetchGdeltQuery(`${safeQuery} (${countryFilter})`)
    addResults(regionResults)
    onRegionDone?.(region, regionResults.length)
  }

  return all
}
