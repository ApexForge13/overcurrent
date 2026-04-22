/**
 * CFTC Commitments of Traders (COT) disaggregated report adapter.
 *
 * Pulls weekly COT data from the CFTC's public open-data endpoint.
 * Released Friday ~15:30 ET for Tuesday's data. T-GT4 evaluates
 * week-over-week deltas in managed-money net positioning.
 *
 * Data source: https://publicreporting.cftc.gov/resource/72hh-3qpw.json
 * (CFTC's disaggregated futures-only combined report, SODA-style CSV
 * also available). We use the JSON endpoint for cleaner parsing.
 *
 * No API key required — public endpoint. Graceful failure returns empty
 * filings + false heartbeat.
 */

import { fetchWithTimeout } from '@/lib/utils'
import type { PrismaClient } from '@prisma/client'

const COT_JSON_URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpw.json'
const TIMEOUT_MS = 30_000
const USER_AGENT = 'Overcurrent/1.0'

export interface CotRow {
  marketCode: string
  exchangeCode: string
  marketName: string
  reportDate: Date
  managedMoneyLongPct: number
  managedMoneyShortPct: number
  managedMoneyNetPct: number
  producerNetPct: number | null
  swapDealerNetPct: number | null
  openInterestTotal: number
}

/**
 * Parse a single row from CFTC's JSON response into our normalized shape.
 * Returns null for rows that don't satisfy our schema (missing key fields,
 * unparseable numbers, etc.).
 */
export function parseCotRow(raw: Record<string, unknown>): CotRow | null {
  const marketCode = String(raw['cftc_contract_market_code'] ?? '').trim()
  const exchangeCode = String(raw['cftc_market_code'] ?? '').trim()
  const marketName = String(raw['market_and_exchange_names'] ?? '').trim()
  const reportDateStr = String(raw['report_date_as_yyyy_mm_dd'] ?? '')
  const reportDate = new Date(reportDateStr)
  if (!marketCode || !exchangeCode || Number.isNaN(reportDate.getTime())) return null

  const openInterest = parseInt(String(raw['open_interest_all'] ?? '0'), 10)
  if (!Number.isFinite(openInterest) || openInterest <= 0) return null

  const mmLong = parseInt(String(raw['m_money_positions_long'] ?? '0'), 10)
  const mmShort = parseInt(String(raw['m_money_positions_short'] ?? '0'), 10)
  const prodLong = parseInt(String(raw['prod_merc_positions_long'] ?? '0'), 10)
  const prodShort = parseInt(String(raw['prod_merc_positions_short'] ?? '0'), 10)
  const swapLong = parseInt(String(raw['swap_positions_long_all'] ?? '0'), 10)
  const swapShort = parseInt(String(raw['swap__positions_short_all'] ?? '0'), 10)

  const mmLongPct = mmLong / openInterest
  const mmShortPct = mmShort / openInterest
  const mmNetPct = (mmLong - mmShort) / openInterest
  const prodNetPct =
    Number.isFinite(prodLong) && Number.isFinite(prodShort)
      ? (prodLong - prodShort) / openInterest
      : null
  const swapNetPct =
    Number.isFinite(swapLong) && Number.isFinite(swapShort)
      ? (swapLong - swapShort) / openInterest
      : null

  return {
    marketCode,
    exchangeCode,
    marketName,
    reportDate,
    managedMoneyLongPct: mmLongPct,
    managedMoneyShortPct: mmShortPct,
    managedMoneyNetPct: mmNetPct,
    producerNetPct: prodNetPct,
    swapDealerNetPct: swapNetPct,
    openInterestTotal: openInterest,
  }
}

/**
 * Fetch the most-recent CFTC COT report. Returns empty array on any
 * failure; heartbeat logged by T-GT4 trigger.
 */
export async function fetchLatestCotReport(): Promise<CotRow[]> {
  try {
    // Fetch latest 200 rows (one week's report covers ~100 markets;
    // 200 gives us headroom for multi-week backfills).
    const res = await fetchWithTimeout(
      `${COT_JSON_URL}?$limit=200&$order=report_date_as_yyyy_mm_dd DESC`,
      TIMEOUT_MS,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
    )
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (!Array.isArray(data)) return []

    const rows: CotRow[] = []
    for (const raw of data) {
      if (raw && typeof raw === 'object') {
        const parsed = parseCotRow(raw as Record<string, unknown>)
        if (parsed) rows.push(parsed)
      }
    }
    return rows
  } catch {
    return []
  }
}

/**
 * Upsert COT rows into CftcPosition. Idempotent on
 * (marketCode, exchangeCode, reportDate) unique key.
 */
export async function upsertCotRows(
  prisma: PrismaClient,
  rows: CotRow[],
): Promise<{ upserted: number }> {
  let upserted = 0
  for (const row of rows) {
    await prisma.cftcPosition.upsert({
      where: {
        marketCode_exchangeCode_reportDate: {
          marketCode: row.marketCode,
          exchangeCode: row.exchangeCode,
          reportDate: row.reportDate,
        },
      },
      create: {
        marketCode: row.marketCode,
        exchangeCode: row.exchangeCode,
        marketName: row.marketName,
        reportDate: row.reportDate,
        managedMoneyLongPct: row.managedMoneyLongPct,
        managedMoneyShortPct: row.managedMoneyShortPct,
        managedMoneyNetPct: row.managedMoneyNetPct,
        producerNetPct: row.producerNetPct,
        swapDealerNetPct: row.swapDealerNetPct,
        openInterestTotal: row.openInterestTotal,
      },
      update: {
        marketName: row.marketName,
        managedMoneyLongPct: row.managedMoneyLongPct,
        managedMoneyShortPct: row.managedMoneyShortPct,
        managedMoneyNetPct: row.managedMoneyNetPct,
        producerNetPct: row.producerNetPct,
        swapDealerNetPct: row.swapDealerNetPct,
        openInterestTotal: row.openInterestTotal,
      },
    })
    upserted++
  }
  return { upserted }
}
