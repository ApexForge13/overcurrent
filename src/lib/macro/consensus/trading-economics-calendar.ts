/**
 * Trading Economics economic calendar scraper — backup source.
 *
 * Called when Investing.com returns null. Parses the calendar row from
 * tradingeconomics.com/calendar?category=... where category maps to our
 * internal indicator IDs via INDICATOR_SLUG_MAP.tradingEconomics.
 *
 * Return shape is identical to investing-calendar.ts so the upsert writer
 * doesn't care which source was used.
 */

import { fetchWithTimeout } from '@/lib/utils'
import { INDICATOR_SLUG_MAP } from './indicator-slug-map'
import { parseNumberWithUnit, normalizeDate } from './investing-calendar'

const BASE = 'https://tradingeconomics.com/calendar'
const TIMEOUT_MS = 30_000
const USER_AGENT =
  'Mozilla/5.0 (compatible; Overcurrent/1.0; +https://overcurrent.org)'

export interface TEConsensusResult {
  indicator: string
  releaseDate: string | null
  consensusValue: number | null
  actualValue: number | null
  unit: string | null
  source: 'trading_economics'
}

/**
 * TE renders rows in a calendar table; columns include date, country,
 * indicator name, actual, previous, consensus, forecast. We target
 * rows where the indicator name substring-matches the TE slug humanized.
 */
export function parseTERow(html: string, slugKey: string): {
  date: string | null
  consensus: number | null
  actual: number | null
  unit: string | null
} | null {
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi

  const needle = slugKey.replace(/-/g, ' ').toLowerCase()

  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1]
    if (!rowHtml.toLowerCase().includes(needle)) continue
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim())
    }
    if (cells.length < 5) continue
    // TE column order (approximate): date, time, country, indicator, actual, previous, consensus
    // Fall back: try to pick the last-but-one column as consensus
    const dateRaw = cells[0]
    const actualRaw = cells[cells.length - 3] ?? ''
    const consensusRaw = cells[cells.length - 1] ?? ''
    return {
      date: normalizeDate(dateRaw),
      actual: parseNumberWithUnit(actualRaw).value,
      consensus: parseNumberWithUnit(consensusRaw).value,
      unit: parseNumberWithUnit(consensusRaw).unit,
    }
  }
  return null
}

export async function scrapeTEConsensus(
  indicator: string,
  _releaseDate?: string,
): Promise<TEConsensusResult | null> {
  const slug = INDICATOR_SLUG_MAP[indicator]?.tradingEconomics
  if (!slug) return null

  let html: string
  try {
    const res = await fetchWithTimeout(
      `${BASE}?category=${encodeURIComponent(slug)}&importance=3`,
      TIMEOUT_MS,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } },
    )
    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  const parsed = parseTERow(html, slug)
  if (!parsed) return null

  return {
    indicator,
    releaseDate: parsed.date,
    consensusValue: parsed.consensus,
    actualValue: parsed.actual,
    unit: parsed.unit,
    source: 'trading_economics',
  }
}
