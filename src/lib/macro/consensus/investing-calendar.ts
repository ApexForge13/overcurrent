/**
 * Investing.com economic calendar scraper.
 *
 * Primary source per manifest A3. Pulls the indicator detail page and
 * parses the "forecast" column (Investing's term for consensus).
 *
 * Parse strategy: the detail page embeds a recent-releases table. Each
 * row has date, actual, forecast (consensus), previous. We pick the
 * row matching our target `releaseDate` (exact YYYY-MM-DD) or the most
 * recent row if no date is supplied.
 *
 * Fragility: Investing.com periodically rerenders the detail page shell
 * and may require auth for dense history. The scraper is best-effort —
 * returns null on any parse failure rather than throwing, so the caller
 * falls back to Trading Economics.
 */

import { fetchWithTimeout } from '@/lib/utils'
import { INDICATOR_SLUG_MAP } from './indicator-slug-map'

const BASE = 'https://www.investing.com/economic-calendar'
const TIMEOUT_MS = 30_000
const USER_AGENT =
  'Mozilla/5.0 (compatible; Overcurrent/1.0; +https://overcurrent.org)'

export interface ConsensusFetchResult {
  indicator: string
  releaseDate: string | null // ISO date YYYY-MM-DD
  consensusValue: number | null
  actualValue: number | null
  unit: string | null
  /** 'investing.com' — distinguishing from TE fallback. */
  source: 'investing.com'
}

/**
 * Parse a single release row out of Investing's detail-page HTML.
 *
 * The page shape varies but the detail table typically has rows like:
 *   <tr>
 *     <td>Apr 18, 2026</td>
 *     <td>275K</td>     <!-- actual -->
 *     <td>240K</td>     <!-- forecast/consensus -->
 *     <td>220K</td>     <!-- previous -->
 *   </tr>
 *
 * We extract the consensus column and parse out numeric + unit.
 * Returns null if the row pattern isn't found.
 */
export function parseConsensusRow(html: string, isoDate?: string): {
  date: string | null
  consensus: number | null
  actual: number | null
  unit: string | null
} | null {
  // Find table rows with 3-4 data cells; the consensus column is the 3rd
  // by default ("Forecast"). Match all rows, iterate until one matches
  // our isoDate if provided, else take the most recent (first in table).
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi

  const candidates: Array<{ cells: string[] }> = []
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim())
    }
    // Valid row has ≥4 cells: date, actual, forecast, previous
    if (cells.length >= 4 && /\d/.test(cells[0])) {
      candidates.push({ cells })
    }
  }
  if (candidates.length === 0) return null

  const pickRow = () => {
    if (!isoDate) return candidates[0]
    // Try to match by date via rough substring (e.g. "Apr 18, 2026" in cell)
    const [year, month, day] = isoDate.split('-').map(Number)
    if (!year || !month || !day) return candidates[0]
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthStr = monthNames[month - 1]
    const needle = `${monthStr} ${day}, ${year}`
    return candidates.find((c) => c.cells[0].includes(needle)) ?? candidates[0]
  }

  const row = pickRow()
  const dateRaw = row.cells[0]
  const actualRaw = row.cells[1]
  const consensusRaw = row.cells[2]

  return {
    date: normalizeDate(dateRaw),
    actual: parseNumberWithUnit(actualRaw).value,
    consensus: parseNumberWithUnit(consensusRaw).value,
    unit: parseNumberWithUnit(consensusRaw).unit,
  }
}

/**
 * Parse a number + unit out of strings like "275K", "4.5%", "2.3B", "-0.1".
 * Returns { value: null, unit: null } when the string is empty/non-numeric.
 */
export function parseNumberWithUnit(raw: string): { value: number | null; unit: string | null } {
  if (!raw) return { value: null, unit: null }
  const trimmed = raw.replace(/[\u00A0\s]/g, '').trim()
  if (!trimmed || trimmed === '-') return { value: null, unit: null }
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)([A-Za-z%$]*)$/)
  if (!m) return { value: null, unit: null }
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return { value: null, unit: null }
  const unit = m[2] || null
  return { value: n, unit }
}

/**
 * Convert "Apr 18, 2026" to ISO "2026-04-18". Returns null when not
 * recognizable. Handles trailing weekday in parentheses too.
 */
export function normalizeDate(raw: string): string | null {
  if (!raw) return null
  const stripped = raw.replace(/\([^)]*\)/g, '').trim()
  const parsed = new Date(stripped)
  if (Number.isNaN(parsed.getTime())) return null
  const iso = parsed.toISOString().split('T')[0]
  return iso
}

/**
 * Fetch consensus for a given indicator on a given release date. Returns
 * null if the indicator is unmapped or the scrape fails. When releaseDate
 * is undefined, returns the most recent row.
 */
export async function scrapeInvestingConsensus(
  indicator: string,
  releaseDate?: string,
): Promise<ConsensusFetchResult | null> {
  const slug = INDICATOR_SLUG_MAP[indicator]?.investing
  if (!slug) return null

  let html: string
  try {
    const res = await fetchWithTimeout(`${BASE}/${slug}`, TIMEOUT_MS, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    })
    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  const parsed = parseConsensusRow(html, releaseDate)
  if (!parsed) return null

  return {
    indicator,
    releaseDate: parsed.date,
    consensusValue: parsed.consensus,
    actualValue: parsed.actual,
    unit: parsed.unit,
    source: 'investing.com',
  }
}
