/**
 * EIA (Energy Information Administration) API v2 client.
 *
 * Free API, key at https://www.eia.gov/opendata/register.php.
 * Phase 1b pulls two weekly series:
 *   - Crude oil stocks  (petroleum/stoc/wstk/data)
 *   - Natural gas stocks (natural-gas/stoc/wkly/data)
 *
 * These feed T-GT8 (Commodity inventory release) — the schema defines
 * MacroRelease.actual as a Float, so we select the single numeric column
 * appropriate to each series.
 */

export interface EiaObservation {
  periodEnd: string // ISO date — end of the reporting week
  value: number
  unit: string
}

export interface EiaIndicatorSpec {
  seriesId: string // Our internal ID, used as MacroRelease.indicator
  displayName: string
  category: 'inventory'
  unit: string
  releaseSchedule: string
  relevantAssets: string[]
  /** EIA v2 API path suffix + data column to select. */
  apiPath: string
  valueColumn: string
  /**
   * Additional query params the endpoint needs.
   * Value type includes `undefined` because the array-literal union inference
   * across multiple indicator configs with different key sets yields optional
   * keys. Runtime loop in fetchEiaSeries filters undefined before appending.
   */
  extraParams?: Record<string, string | undefined>
}

export const EIA_INDICATORS: readonly EiaIndicatorSpec[] = Object.freeze([
  {
    seriesId: 'EIA_CRUDE',
    displayName: 'EIA Weekly Crude Oil Stocks',
    category: 'inventory',
    unit: 'thousand bbl',
    releaseSchedule: 'weekly, Wednesday 10:30 ET',
    relevantAssets: ['CL=F', 'BZ=F', 'XOM', 'CVX', 'USO', 'XLE'],
    apiPath: 'petroleum/stoc/wstk/data',
    valueColumn: 'value',
    extraParams: {
      'facets[product][]': 'EPC0',        // Crude oil
      'facets[duoarea][]': 'NUS',         // US total
      'frequency': 'weekly',
      'data[0]': 'value',
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
    },
  },
  {
    seriesId: 'EIA_NATGAS',
    displayName: 'EIA Weekly Natural Gas in Underground Storage',
    category: 'inventory',
    unit: 'Bcf',
    releaseSchedule: 'weekly, Thursday 10:30 ET',
    relevantAssets: ['NG=F', 'UNG'],
    apiPath: 'natural-gas/stoc/wkly/data',
    valueColumn: 'value',
    extraParams: {
      'facets[duoarea][]': 'NUS',
      'frequency': 'weekly',
      'data[0]': 'value',
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
    },
  },
])

export interface FetchEiaOptions {
  apiKey?: string
  startDate?: string
  endDate?: string
  fetchImpl?: typeof fetch
  now?: Date
}

export async function fetchEiaSeries(
  spec: EiaIndicatorSpec,
  opts: FetchEiaOptions = {},
): Promise<EiaObservation[]> {
  const apiKey = opts.apiKey ?? process.env.EIA_API_KEY
  if (!apiKey) {
    throw new Error(
      'EIA_API_KEY not set. Get a free key at https://www.eia.gov/opendata/register.php and add to .env.',
    )
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()
  const fiveYearsAgo = new Date(now)
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  const start = opts.startDate ?? fiveYearsAgo.toISOString().slice(0, 10)
  const end = opts.endDate ?? now.toISOString().slice(0, 10)

  const url = new URL(`https://api.eia.gov/v2/${spec.apiPath}/`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('start', start)
  url.searchParams.set('end', end)
  for (const [k, v] of Object.entries(spec.extraParams ?? {})) {
    if (v !== undefined) url.searchParams.append(k, v)
  }

  const resp = await fetchImpl(url.toString())
  if (!resp.ok) {
    throw new Error(`EIA fetch failed for ${spec.seriesId}: ${resp.status} ${resp.statusText}`)
  }
  const body = (await resp.json()) as {
    response?: { data?: Array<Record<string, unknown>> }
  }
  return parseEiaResponse(body, spec.valueColumn, spec.unit)
}

export function parseEiaResponse(
  body: { response?: { data?: Array<Record<string, unknown>> } },
  valueColumn: string,
  unit: string,
): EiaObservation[] {
  const rows = body?.response?.data
  if (!Array.isArray(rows)) return []
  const out: EiaObservation[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const period = typeof row.period === 'string' ? row.period : null
    const raw = row[valueColumn]
    const num =
      typeof raw === 'number' ? raw
      : typeof raw === 'string' ? Number(raw)
      : NaN
    if (!period || Number.isNaN(num)) continue
    out.push({ periodEnd: period, value: num, unit })
  }
  return out
}
