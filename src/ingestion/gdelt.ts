import { fetchWithTimeout } from '@/lib/utils'

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

  // Build 2-word bigrams from significant words (4+ chars)
  const significantWords = words.filter(w => w.replace(/"/g, '').length >= 4)
  const bigrams: string[] = []
  for (let i = 0; i < significantWords.length - 1; i++) {
    bigrams.push(`"${significantWords[i]} ${significantWords[i + 1]}"`)
  }

  // Pick the 2-3 most specific words (longest, most unique) for AND clause
  const keyTerms = significantWords
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)

  // Combine: bigrams OR (key terms AND-joined)
  const parts: string[] = []
  if (bigrams.length > 0) parts.push(bigrams.join(' OR '))
  if (keyTerms.length >= 2) parts.push(`(${keyTerms.join(' ')})`)

  const result = parts.join(' OR ')
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
  try {
    const url = buildUrl(query, maxrecords)
    const response = await fetchWithTimeout(url, 15_000)
    if (!response.ok) return []

    const text = await response.text()

    // GDELT returns plain text errors for rate limits, bad queries, etc.
    if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
      console.warn('[GDELT] Non-JSON response:', text.substring(0, 100))
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
  } catch (err) {
    console.warn('[GDELT] Fetch error:', err instanceof Error ? err.message : err)
    return []
  }
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
  return fetchGdeltQuery(safeQuery, 250)
}
