import { fetchWithTimeout } from '@/lib/utils'

/** Strip diacritics/accents for GDELT API compatibility */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one',
  'our', 'out', 'has', 'had', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'way',
  'who', 'did', 'got', 'let', 'say', 'she', 'too', 'use', 'after', 'years', 'over',
  'under', 'from', 'with', 'when', 'where', 'what', 'why', 'into', 'than', 'been',
  'have', 'will', 'more', 'some', 'very', 'just', 'about', 'before', 'between', 'through',
  'during', 'without', 'again', 'votes', 'says',
])

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
const TIMESPAN = '14d'

/**
 * Common synonyms/related terms for international news topics.
 * Each variation MUST include the topic anchor to stay relevant.
 */
const QUERY_SYNONYMS: Record<string, string[]> = {
  crisis: ['emergency', 'humanitarian'],
  war: ['conflict', 'military', 'strikes'],
  ceasefire: ['truce', 'peace talks', 'armistice'],
  negotiations: ['talks', 'diplomacy', 'deal'],
  sanctions: ['embargo', 'restrictions'],
  protest: ['demonstrations', 'unrest', 'uprising'],
  election: ['vote', 'ballot', 'polling'],
  refugee: ['displaced', 'asylum'],
  migrant: ['migration', 'immigrant', 'refugee'],
  blockade: ['embargo', 'naval blockade', 'siege'],
  nuclear: ['atomic', 'enrichment'],
  attack: ['strike', 'assault', 'offensive'],
  invasion: ['incursion', 'offensive'],
}

/**
 * Build a GDELT query from a natural-language topic.
 *
 * Strategy: 2-word bigrams (from 4+ char words) as primary search,
 * plus AND-joined key terms as a broad catch. No full-phrase quoting
 * for queries over 3 words — GDELT returns near-zero for long exact phrases.
 *
 * "Iran Strait of Hormuz blockade" →
 *   "Iran Strait" OR "Strait Hormuz" OR "Hormuz blockade" OR (blockade Hormuz Iran)
 */
function buildGdeltQuery(query: string): string {
  query = stripDiacritics(query)

  const words = query
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((word) => {
      // Quote hyphenated words — GDELT rejects bare hyphens
      if (word.includes('-') && !word.startsWith('"')) return `"${word}"`
      return word
    })

  if (words.length < 2) {
    console.warn('[GDELT] Query too short after filtering:', words.join(' '))
    return ''
  }

  // For short queries (2 words), just AND them
  if (words.length <= 2) {
    const result = words.join(' ')
    console.log('[GDELT] Query:', result)
    return result
  }

  // Filter to significant words: 4+ chars, not stop words
  const significantWords = words.filter(w => {
    const clean = w.replace(/"/g, '')
    if (clean.length < 4) return false
    if (STOP_WORDS.has(clean.toLowerCase())) return false
    return true
  })

  // Build bigrams from significant words, max 3
  const bigrams: string[] = []
  for (let i = 0; i < significantWords.length - 1 && bigrams.length < 3; i++) {
    bigrams.push(`"${significantWords[i]} ${significantWords[i + 1]}"`)
  }

  // If no bigrams possible, just AND the significant words
  if (bigrams.length === 0) {
    const result = significantWords.slice(0, 3).join(' ')
    console.log('[GDELT] Query:', result)
    return result
  }

  // GDELT requires OR'd terms to be wrapped in parentheses
  const result = bigrams.length > 1 ? `(${bigrams.join(' OR ')})` : bigrams[0]
  console.log('[GDELT] Query:', result)
  return result
}

/**
 * Build a GDELT query URL.
 */
function buildUrl(query: string, maxrecords: number = 250): string {
  const params = new URLSearchParams({
    query,
    mode: 'ArtList',
    maxrecords: String(maxrecords),
    format: 'json',
    sort: 'DateDesc',
    timespan: TIMESPAN,
  })
  return `${GDELT_BASE}?${params.toString()}`
}

/**
 * Fetch articles from GDELT for a single query string.
 */
async function fetchGdeltQuery(query: string, maxrecords: number = 250): Promise<GdeltResult[]> {
  const url = buildUrl(query, maxrecords)
  // GDELT rate-limits aggressively. 3s/8s delays weren't enough — every attempt
  // was returning 429. Use 10s/20s/30s backoff to actually wait out the window.
  const delays = [0, 10_000, 20_000, 30_000]

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      console.log(`[GDELT] Retry ${attempt} after ${delays[attempt] / 1000}s...`)
      await new Promise(r => setTimeout(r, delays[attempt]))
    }

    try {
      const response = await fetchWithTimeout(url, 25_000)

      // 429 = rate limited — retryable with longer backoff
      if (response.status === 429) {
        console.warn(`[GDELT] Rate limited (429) on attempt ${attempt + 1}/${delays.length}. Query: ${query}`)
        continue
      }

      // Other 4xx = bad request — not retryable
      if (response.status >= 400 && response.status < 500) {
        console.warn(`[GDELT] Client error ${response.status} — not retrying. Query: ${query}`)
        return []
      }

      if (!response.ok) {
        console.warn(`[GDELT] HTTP ${response.status} on attempt ${attempt + 1}`)
        continue  // retry on 5xx
      }

      const text = await response.text()

      // GDELT sometimes returns HTML error pages
      if (text.trimStart().startsWith('<')) {
        console.warn(`[GDELT] Received HTML instead of JSON on attempt ${attempt + 1}. Query may be malformed.`)
        if (attempt < delays.length - 1) continue
        return []
      }

      if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
        console.warn('[GDELT] Non-JSON response:', text.substring(0, 200))
        return []
      }

      const data = JSON.parse(text)
      const articles = data?.articles
      if (!Array.isArray(articles)) return []

      console.log(`[GDELT] Got ${articles.length} articles on attempt ${attempt + 1}`)

      return articles.map((a: Record<string, unknown>) => ({
        url: String(a.url ?? ''),
        title: String(a.title ?? ''),
        seendate: String(a.seendate ?? ''),
        socialimage: a.socialimage ? String(a.socialimage) : undefined,
        domain: String(a.domain ?? ''),
        language: String(a.language ?? ''),
        sourcecountry: String(a.sourcecountry ?? ''),
      }))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errCause = err instanceof Error && err.cause ? ` (cause: ${err.cause})` : ''
      console.warn(`[GDELT] Fetch error on attempt ${attempt + 1}: ${errMsg}${errCause}`)
      if (attempt === 2) {
        console.error(`[GDELT] All 3 attempts failed for query: ${query}`)
      }
    }
  }

  return []
}

/**
 * Map a GDELT sourcecountry name to one of the 6 standard regions.
 */
const COUNTRY_TO_REGION: Record<string, string> = {
  // North America
  'United States': 'North America', 'Canada': 'North America', 'Mexico': 'North America',
  // Europe
  'United Kingdom': 'Europe', 'France': 'Europe', 'Germany': 'Europe', 'Italy': 'Europe',
  'Spain': 'Europe', 'Netherlands': 'Europe', 'Belgium': 'Europe', 'Sweden': 'Europe',
  'Norway': 'Europe', 'Denmark': 'Europe', 'Finland': 'Europe', 'Poland': 'Europe',
  'Ireland': 'Europe', 'Switzerland': 'Europe', 'Austria': 'Europe', 'Portugal': 'Europe',
  'Greece': 'Europe', 'Czech Republic': 'Europe', 'Romania': 'Europe', 'Hungary': 'Europe',
  'Ukraine': 'Europe', 'Russia': 'Europe', 'Turkey': 'Europe',
  // Asia-Pacific
  'China': 'Asia-Pacific', 'Japan': 'Asia-Pacific', 'South Korea': 'Asia-Pacific',
  'Australia': 'Asia-Pacific', 'New Zealand': 'Asia-Pacific', 'Singapore': 'Asia-Pacific',
  'Taiwan': 'Asia-Pacific', 'Hong Kong': 'Asia-Pacific', 'Philippines': 'Asia-Pacific',
  'Thailand': 'Asia-Pacific', 'Vietnam': 'Asia-Pacific', 'Indonesia': 'Asia-Pacific',
  'Malaysia': 'Asia-Pacific',
  // Middle East & Africa
  'Israel': 'Middle East & Africa', 'Iran': 'Middle East & Africa', 'Iraq': 'Middle East & Africa',
  'Saudi Arabia': 'Middle East & Africa', 'United Arab Emirates': 'Middle East & Africa',
  'Qatar': 'Middle East & Africa', 'Egypt': 'Middle East & Africa', 'Jordan': 'Middle East & Africa',
  'Lebanon': 'Middle East & Africa', 'Syria': 'Middle East & Africa', 'Yemen': 'Middle East & Africa',
  'Kenya': 'Middle East & Africa', 'South Africa': 'Middle East & Africa',
  'Nigeria': 'Middle East & Africa', 'Ghana': 'Middle East & Africa',
  // Latin America
  'Brazil': 'Latin America', 'Argentina': 'Latin America', 'Colombia': 'Latin America',
  'Chile': 'Latin America', 'Peru': 'Latin America', 'Venezuela': 'Latin America',
  'Cuba': 'Latin America', 'Uruguay': 'Latin America', 'Ecuador': 'Latin America',
  // South & Central Asia
  'India': 'South & Central Asia', 'Pakistan': 'South & Central Asia',
  'Bangladesh': 'South & Central Asia', 'Sri Lanka': 'South & Central Asia',
  'Nepal': 'South & Central Asia', 'Afghanistan': 'South & Central Asia',
}

export function getRegionFromCountryName(country: string): string {
  return COUNTRY_TO_REGION[country] || 'Unknown'
}

/**
 * Search GDELT with a single efficient query.
 * Makes just 1 API call with 250 max records — no rate limit issues.
 * The sourcecountry field on each result lets us assign regions later.
 */
export async function searchGdelt(
  query: string,
  region?: string,
): Promise<GdeltResult[]> {
  const safeQuery = buildGdeltQuery(query)
  if (!safeQuery) return []
  return fetchGdeltQuery(region ? `${safeQuery} sourcecountry:"${region}"` : safeQuery)
}

/**
 * Search GDELT globally — single API call, 250 results.
 * Returns results with sourcecountry populated.
 */
export async function searchGdeltGlobal(query: string): Promise<GdeltResult[]> {
  const safeQuery = buildGdeltQuery(query)
  if (!safeQuery) return []

  const results = await fetchGdeltQuery(safeQuery, 250)

  // If primary query failed, try simplified fallback
  if (results.length === 0) {
    const stripped = stripDiacritics(query)
    const fallbackWords = stripped
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()))
      .slice(0, 3)

    if (fallbackWords.length >= 2) {
      const fallback = fallbackWords.join(' ')
      console.log(`[GDELT] Primary query returned 0 results. Trying fallback: ${fallback}`)
      return fetchGdeltQuery(fallback, 250)
    }
  }

  return results
}
