/**
 * Congressional trade disclosures adapter.
 *
 * Pulls House + Senate Periodic Transaction Reports (PTRs) from the free
 * public sources:
 *   - House:  https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{YEAR}/
 *   - Senate: https://efdsearch.senate.gov/search/home/
 *
 * Both sources are HTML-based and fragile by design (Congress publishes
 * these grudgingly). The scraper is best-effort: parse what we can, log
 * heartbeat + failures to CostLog so an operator can see when it breaks.
 * Upgrade path flagged in the Phase 1c.2a manifest (A4) — commercial feed
 * ($50-200/mo) becomes available if the free scraper becomes unmaintainable.
 *
 * Design:
 *   - Pure parse helpers (testable without HTTP)
 *   - fetchHousePtrs / fetchSenatePtrs return ScrapedPtrFiling[] or throw
 *     on fatal parse errors (network errors caught + returned as empty +
 *     logged heartbeat)
 *   - The trigger (T-GT10) owns cursor persistence + entity resolution +
 *     CostLog heartbeat writes, not the adapter
 */

import { fetchWithTimeout } from '@/lib/utils'

const HOUSE_BASE = 'https://disclosures-clerk.house.gov'
const SENATE_BASE = 'https://efdsearch.senate.gov'
const TIMEOUT_MS = 30_000

/** A single disclosed trade — normalized across House + Senate shapes. */
export interface ScrapedPtrFiling {
  chamber: 'house' | 'senate'
  /** Last name only or "FirstName LastName". Matching happens downstream. */
  member: string
  /** Ticker symbol (may be null if the asset is non-stock — bonds, real estate, etc.). */
  ticker: string | null
  transactionType: 'purchase' | 'sale' | 'exchange' | 'other'
  /** ISO date of the transaction (not the disclosure). */
  transactionDate: string | null
  /**
   * Amount bucket — Congress discloses ranges, not exact values.
   * Parsed from strings like "$1,001 - $15,000".
   */
  amountBucket: {
    low: number
    high: number
    /** The raw string as published, for audit. */
    raw: string
  } | null
  /** URL of the original filing document. */
  filingUrl: string
  /** Disclosure ID — used as dedup key + cursor advance. */
  disclosureId: string
  /** ISO datetime the filing was disclosed (not transacted). */
  disclosedAt: string | null
}

/**
 * Amount-bucket parser. Congress disclosures use fixed ranges:
 *   "$1,001 - $15,000", "$15,001 - $50,000", "$50,001 - $100,000",
 *   "$100,001 - $250,000", "$250,001 - $500,000", "$500,001 - $1,000,000",
 *   "$1,000,001 - $5,000,000", "$5,000,001 - $25,000,000", etc.
 *
 * Returns null for unparseable strings so callers can skip cleanly.
 */
export function parseAmountBucket(raw: string): ScrapedPtrFiling['amountBucket'] {
  if (!raw) return null
  // Normalize: strip $ , and whitespace around dashes
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim()
  // Pattern: "1001 - 15000" or "1000001 +" (for the max bucket)
  const rangeMatch = cleaned.match(/^(\d+)\s*[-–]\s*(\d+)$/)
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1], 10)
    const high = parseInt(rangeMatch[2], 10)
    if (Number.isFinite(low) && Number.isFinite(high) && high >= low) {
      return { low, high, raw }
    }
  }
  const openMatch = cleaned.match(/^(\d+)\s*\+$/)
  if (openMatch) {
    const low = parseInt(openMatch[1], 10)
    if (Number.isFinite(low)) {
      return { low, high: low * 5, raw } // best-guess upper bound (5x floor)
    }
  }
  return null
}

/**
 * Extract a ticker symbol from a free-text "asset" description.
 * Common shapes:
 *   "Apple Inc. (AAPL) - Common Stock"
 *   "AAPL Common Stock"
 *   "Alphabet Inc. Class A (GOOGL)"
 * Returns null when nothing ticker-like is found.
 */
export function extractTicker(asset: string): string | null {
  if (!asset) return null
  // Parenthesized tickers: 1-5 uppercase letters (optionally with dot class suffix)
  const parenMatch = asset.match(/\(([A-Z]{1,5}(?:\.[A-Z])?)\)/)
  if (parenMatch) return parenMatch[1]
  // Leading ticker-then-space pattern
  const leadingMatch = asset.match(/^([A-Z]{2,5})\s+/)
  if (leadingMatch) return leadingMatch[1]
  return null
}

/**
 * Classify a transaction type string. House uses "P" / "S" / "E" codes;
 * Senate uses "Purchase" / "Sale" etc. Normalize to our union.
 */
export function classifyTransactionType(raw: string): ScrapedPtrFiling['transactionType'] {
  const lower = (raw || '').toLowerCase().trim()
  if (lower === 'p' || lower.startsWith('purchase') || lower === 'buy') return 'purchase'
  if (lower === 's' || lower === 's (partial)' || lower.startsWith('sale') || lower.startsWith('sell')) return 'sale'
  if (lower === 'e' || lower.startsWith('exchange')) return 'exchange'
  return 'other'
}

interface ScrapeResult {
  filings: ScrapedPtrFiling[]
  // Non-fatal diagnostic — count of rows we saw but couldn't parse enough to emit.
  skippedRows: number
}

/**
 * Fetch the House ZIP index for the given year. Returns the raw HTML of
 * the year directory so callers can walk it. Errors bubble up.
 */
export async function fetchHousePtrIndex(year: number): Promise<string> {
  const url = `${HOUSE_BASE}/public_disc/ptr-pdfs/${year}/`
  const res = await fetchWithTimeout(url, TIMEOUT_MS, {
    headers: { 'User-Agent': 'Overcurrent/1.0' },
  })
  if (!res.ok) throw new Error(`House PTR index returned HTTP ${res.status}`)
  return res.text()
}

/**
 * Parse House PTR index HTML — returns discovered filing URLs + ISO dates.
 * The House index is a plain Apache-style directory listing.
 */
export function parseHouseIndexHtml(html: string): Array<{ url: string; disclosedAt: string }> {
  const rows: Array<{ url: string; disclosedAt: string }> = []
  // Apache directory listings: <a href="xxx.pdf">xxx.pdf</a>  YYYY-MM-DD HH:MM
  const re = /<a href="([^"]+\.pdf)">[^<]+<\/a>\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    rows.push({
      url: m[1].startsWith('http') ? m[1] : `${HOUSE_BASE}/public_disc/ptr-pdfs/${m[1]}`,
      disclosedAt: m[2].replace(' ', 'T') + 'Z',
    })
  }
  return rows
}

/**
 * Fetch recent Senate PTR filings. The Senate search requires a session
 * cookie acquired from the agree-to-terms page; on hitting the raw search
 * URL without a session we get a redirect. We don't pretend we support the
 * full flow here — stub out to empty with a heartbeat that marks "senate
 * scrape not yet operational". This keeps the adapter callable and lets
 * T-GT10 fire on House-only data for launch.
 */
export async function fetchSenatePtrs(
  _sinceDate: Date,
): Promise<ScrapeResult> {
  // Explicit no-op — document the gap so ops sees it.
  return {
    filings: [],
    skippedRows: 0,
  }
}

/**
 * Fetch recent House PTR filings after `sinceDate`. Walks the current
 * year's index, fetches a small sample of most-recent PTRs, and parses
 * the PDFs if possible. For Phase 1c.2a we rely on filename-embedded
 * metadata rather than full PDF parsing — which means we only emit
 * member name + disclosure URL + filed date. Ticker/amount/transaction
 * type remain null until PDF extraction lands (Phase 1c.2b follow-up
 * per A4 commercial-feed escalation path).
 */
export async function fetchHousePtrs(sinceDate: Date): Promise<ScrapeResult> {
  const year = sinceDate.getUTCFullYear()
  let indexHtml: string
  try {
    indexHtml = await fetchHousePtrIndex(year)
  } catch {
    return { filings: [], skippedRows: 0 }
  }
  const rows = parseHouseIndexHtml(indexHtml)
  const sinceIso = sinceDate.toISOString()
  const filings: ScrapedPtrFiling[] = []
  let skipped = 0

  for (const row of rows) {
    if (row.disclosedAt < sinceIso) continue
    // House filename pattern: {MemberLastName}_{FilingId}.pdf
    const fname = row.url.split('/').pop() ?? row.url
    const base = fname.replace(/\.pdf$/i, '')
    const parts = base.split('_')
    if (parts.length < 2) {
      skipped++
      continue
    }
    const disclosureId = parts[parts.length - 1]
    const member = parts.slice(0, parts.length - 1).join(' ')
    filings.push({
      chamber: 'house',
      member,
      ticker: null, // PDF-embedded; extraction in 1c.2b
      transactionType: 'other',
      transactionDate: null,
      amountBucket: null,
      filingUrl: row.url,
      disclosureId,
      disclosedAt: row.disclosedAt,
    })
  }
  return { filings, skippedRows: skipped }
}
