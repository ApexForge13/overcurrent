/**
 * SEC company-ticker source loader.
 *
 * Pulls https://www.sec.gov/files/company_tickers.json — free, no API key,
 * no rate-limit issues for a one-shot seed. Returns a map keyed by CIK with
 * { cik_str, ticker, title }. ~10,000 US-listed companies.
 *
 * We treat every ticker as an "equity" for Phase 1b — subcategory refinement
 * (large_cap / mid_cap / small_cap) needs market-cap data from a different
 * source and is deferred. This is intentionally conservative: better to have
 * all equities in the registry with minimal metadata than to over-invest in
 * categorization that Phase 2 code doesn't need yet.
 *
 * Ticker format caveats:
 *   - SEC feeds sometimes include class suffixes (e.g., "BRK-B", "GOOG",
 *     "GOOGL"). We keep both as distinct entities — they trade separately.
 *   - ETFs (registered investment companies like "SPY", "QQQ") ARE in this
 *     feed. The ETF loader deduplicates against the SEC output via
 *     TrackedEntity.identifier.
 */

import type { TrackedEntityInput } from '../types'

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'

interface SecTickerRow {
  cik_str: number | string
  ticker: string
  title: string
}

type SecResponse = Record<string, SecTickerRow>

/** Ground-truth triggers that apply to every US equity. */
const EQUITY_TRIGGERS = Object.freeze([
  'T-GT1', // Form 4 — insider transaction
  'T-GT2', // 13D/G — activist stake
  'T-GT3', // 8-K — material event
  'T-GT5', // intraday price move
  'T-GT6', // overnight price gap
  'T-GT10', // Congressional trade disclosure
  'T-GT11', // earnings transcript
])

export interface LoadSecOptions {
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export async function loadSecEntities(opts: LoadSecOptions = {}): Promise<TrackedEntityInput[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  // SEC requires a descriptive User-Agent for non-browser requests.
  const resp = await fetchImpl(SEC_TICKERS_URL, {
    headers: { 'User-Agent': 'Overcurrent Signal Platform (ops@overcurrent.news)' },
  })
  if (!resp.ok) {
    throw new Error(`SEC tickers fetch failed: ${resp.status} ${resp.statusText}`)
  }
  const body = (await resp.json()) as SecResponse
  return parseSecResponse(body)
}

/**
 * Pure function — extracted so we can test parsing without hitting the
 * network. Filters rows with malformed data; doesn't mutate input.
 */
export function parseSecResponse(body: SecResponse): TrackedEntityInput[] {
  const out: TrackedEntityInput[] = []
  for (const row of Object.values(body)) {
    if (!row || typeof row !== 'object') continue
    const ticker = typeof row.ticker === 'string' ? row.ticker.trim().toUpperCase() : ''
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const cikRaw = row.cik_str
    if (!ticker || !title) continue
    const cik =
      typeof cikRaw === 'number' ? String(cikRaw).padStart(10, '0')
      : typeof cikRaw === 'string' ? cikRaw.padStart(10, '0')
      : ''
    out.push({
      identifier: ticker,
      name: title,
      category: 'equity',
      providerIds: {
        cik,
      },
      groundTruthMap: {
        applicableTriggers: [...EQUITY_TRIGGERS],
      },
      entityStrings: {
        aliases: Array.from(new Set([ticker, title, `$${ticker}`])),
      },
    })
  }
  return out
}
