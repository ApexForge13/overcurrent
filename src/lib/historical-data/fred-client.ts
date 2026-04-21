/**
 * FRED (St. Louis Fed) API client — macro indicator historical series.
 *
 * Free API, requires a free key at https://fred.stlouisfed.org/docs/api/api_key.html.
 * Endpoint: /fred/series/observations?series_id=X&api_key=Y&file_type=json
 *
 * Response format:
 *   { observations: [{ date: "2024-01-01", value: "3.7" }, ...] }
 * Values come as strings; "." indicates a release with no data (skip).
 *
 * Phase 1b usage: load 5yr of history for ~15 indicators (FRED_INDICATORS
 * below) via `scripts/load-historical-macro.ts`. The script populates
 * MacroRelease rows; the proxy stddev gets computed downstream from this
 * data by `surprise-proxy.ts`.
 */

export interface FredObservation {
  date: string // ISO date
  value: number
}

export interface FredIndicatorSpec {
  seriesId: string // FRED series ID, e.g., "PAYEMS"
  displayName: string
  category: 'employment' | 'inflation' | 'growth' | 'sentiment' | 'monetary_policy'
  unit: string
  releaseSchedule: string // Human-readable cadence
  // TrackedEntity.identifier values affected by this indicator
  relevantAssets: string[]
}

/** The 15 Phase 1b-approved FRED indicators. */
export const FRED_INDICATORS: readonly FredIndicatorSpec[] = Object.freeze([
  { seriesId: 'PAYEMS',        displayName: 'Nonfarm Payrolls',             category: 'employment',    unit: 'K jobs', releaseSchedule: 'monthly, 1st Friday', relevantAssets: ['SPY', 'QQQ', 'TLT', 'GC=F'] },
  { seriesId: 'CPIAUCSL',      displayName: 'CPI All Urban Consumers',      category: 'inflation',     unit: 'index',  releaseSchedule: 'monthly, mid-month',  relevantAssets: ['SPY', 'TLT', 'GC=F'] },
  { seriesId: 'CPILFESL',      displayName: 'Core CPI',                     category: 'inflation',     unit: 'index',  releaseSchedule: 'monthly, mid-month',  relevantAssets: ['SPY', 'TLT', 'GC=F'] },
  { seriesId: 'PPIACO',        displayName: 'Producer Price Index',         category: 'inflation',     unit: 'index',  releaseSchedule: 'monthly, mid-month',  relevantAssets: ['SPY', 'TLT'] },
  { seriesId: 'RSAFS',         displayName: 'Retail Sales',                 category: 'growth',        unit: '$M',     releaseSchedule: 'monthly, mid-month',  relevantAssets: ['SPY', 'QQQ'] },
  { seriesId: 'INDPRO',        displayName: 'Industrial Production',        category: 'growth',        unit: 'index',  releaseSchedule: 'monthly',             relevantAssets: ['SPY'] },
  { seriesId: 'GDPC1',         displayName: 'Real GDP',                     category: 'growth',        unit: '$B',     releaseSchedule: 'quarterly',           relevantAssets: ['SPY', 'QQQ'] },
  { seriesId: 'UNRATE',        displayName: 'Unemployment Rate',            category: 'employment',    unit: '%',      releaseSchedule: 'monthly, 1st Friday', relevantAssets: ['SPY', 'TLT'] },
  { seriesId: 'FEDFUNDS',      displayName: 'Federal Funds Effective Rate', category: 'monetary_policy', unit: '%',    releaseSchedule: 'FOMC days',           relevantAssets: ['SPY', 'TLT', 'GC=F'] },
  { seriesId: 'CES0500000003', displayName: 'Avg Hourly Earnings',          category: 'inflation',     unit: '$',      releaseSchedule: 'monthly, 1st Friday', relevantAssets: ['SPY', 'TLT'] },
  { seriesId: 'HOUST',         displayName: 'Housing Starts',               category: 'growth',        unit: 'K',      releaseSchedule: 'monthly',             relevantAssets: ['SPY'] },
  { seriesId: 'ICSA',          displayName: 'Initial Jobless Claims',       category: 'employment',    unit: '',       releaseSchedule: 'weekly, Thursday',    relevantAssets: ['SPY', 'TLT'] },
  { seriesId: 'IPMAN',         displayName: 'Industrial Production - Manufacturing', category: 'growth', unit: 'index', releaseSchedule: 'monthly',            relevantAssets: ['SPY'] },
  { seriesId: 'CIVPART',       displayName: 'Labor Force Participation',    category: 'employment',    unit: '%',      releaseSchedule: 'monthly',             relevantAssets: ['SPY'] },
  { seriesId: 'UMCSENT',       displayName: 'U. Michigan Consumer Sentiment', category: 'sentiment',   unit: 'index',  releaseSchedule: 'monthly',             relevantAssets: ['SPY', 'QQQ'] },
])

export interface FetchFredOptions {
  apiKey?: string
  /** Start date inclusive — defaults to 5y ago from `now`. */
  observationStart?: string // YYYY-MM-DD
  /** End date inclusive — defaults to today. */
  observationEnd?: string
  fetchImpl?: typeof fetch
  now?: Date
}

export async function fetchFredSeries(
  seriesId: string,
  opts: FetchFredOptions = {},
): Promise<FredObservation[]> {
  const apiKey = opts.apiKey ?? process.env.FRED_API_KEY
  if (!apiKey) {
    throw new Error(
      'FRED_API_KEY not set. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html and add to .env.',
    )
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()
  const fiveYearsAgo = new Date(now)
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  const obsStart = opts.observationStart ?? fiveYearsAgo.toISOString().slice(0, 10)
  const obsEnd = opts.observationEnd ?? now.toISOString().slice(0, 10)

  const url = new URL('https://api.stlouisfed.org/fred/series/observations')
  url.searchParams.set('series_id', seriesId)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('file_type', 'json')
  url.searchParams.set('observation_start', obsStart)
  url.searchParams.set('observation_end', obsEnd)

  const resp = await fetchImpl(url.toString())
  if (!resp.ok) {
    throw new Error(`FRED fetch failed for ${seriesId}: ${resp.status} ${resp.statusText}`)
  }
  const body = (await resp.json()) as { observations?: Array<{ date: string; value: string }> }
  return parseFredObservations(body)
}

export function parseFredObservations(body: {
  observations?: Array<{ date: string; value: string }>
}): FredObservation[] {
  const raw = Array.isArray(body.observations) ? body.observations : []
  const out: FredObservation[] = []
  for (const row of raw) {
    if (!row || typeof row.date !== 'string' || typeof row.value !== 'string') continue
    // FRED encodes "no data" as "." — skip those.
    if (row.value === '.') continue
    const num = Number(row.value)
    if (Number.isNaN(num)) continue
    out.push({ date: row.date, value: num })
  }
  return out
}
