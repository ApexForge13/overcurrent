/**
 * T-GT10 — Congressional trade disclosure.
 *
 * Polls House + Senate PTR scrapers (src/lib/raw-signals/integrations/
 * congress-trade.ts) for newly disclosed trades since the cursor.
 * Resolves each disclosed ticker to TrackedEntity.identifier (exact match).
 * Fires with elevation-based severity per Phase 1 addendum A1.4 T-GT10:
 *
 *   Base severity:    0.4
 *   Elevation +0.2:   transaction_value > $50K (using amount-bucket low)
 *   Elevation +0.2:   ≥2 members trading same ticker within 30 days
 *   Elevation +0.2:   member serves on committee with jurisdiction over sector
 *   Cap:              1.0
 *   Direction:        purchase → +1, sale → -1, other → 0
 *
 * Scraper heartbeat: operation='congress-trade-scrape-heartbeat' written
 * to CostLog on every scan (success or failure) so dormant T-GT10 doesn't
 * silently persist through a broken scraper. Manifest A4 decision.
 *
 * Unresolved tickers: operation='congressional-trade-unmatched-ticker'
 * written to CostLog for registry expansion audit trail.
 *
 * Cursor: 'disclosure_cursor' on TriggerCursor — ISO datetime of the latest
 * disclosure processed.
 */

import type { PrismaClient } from '@prisma/client'
import type { TriggerContext, TriggerFireEvent } from '../types'
import {
  fetchHousePtrs,
  fetchSenatePtrs,
  type ScrapedPtrFiling,
} from '@/lib/raw-signals/integrations/congress-trade'

const TRIGGER_ID = 'T-GT10'
const CURSOR_TYPE = 'disclosure_cursor'
const DEFAULT_LOOKBACK_DAYS = 7
const HIGH_VALUE_THRESHOLD_USD = 50_000
const MULTI_MEMBER_WINDOW_DAYS = 30
const MULTI_MEMBER_FLOOR = 2

async function readCursor(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.triggerCursor.findUnique({
    where: { triggerId_cursorType: { triggerId: TRIGGER_ID, cursorType: CURSOR_TYPE } },
    select: { cursorValue: true },
  })
  return row?.cursorValue ?? null
}

async function writeCursor(prisma: PrismaClient, cursorValue: string): Promise<void> {
  await prisma.triggerCursor.upsert({
    where: { triggerId_cursorType: { triggerId: TRIGGER_ID, cursorType: CURSOR_TYPE } },
    create: { triggerId: TRIGGER_ID, cursorType: CURSOR_TYPE, cursorValue },
    update: { cursorValue },
  })
}

async function writeHeartbeat(
  prisma: PrismaClient,
  outcome: 'success' | 'empty' | 'failure',
  detail: Record<string, unknown>,
): Promise<void> {
  await prisma.costLog.create({
    data: {
      model: 'trigger_runner',
      agentType: 'trigger_scrape_heartbeat',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: 'trigger',
      operation: 'congress-trade-scrape-heartbeat',
      metadata: { triggerId: TRIGGER_ID, outcome, ...detail },
    },
  })
}

/**
 * Resolve PTR tickers to TrackedEntity rows. Exact identifier match only —
 * congressional disclosures use canonical tickers so no CIK fallback needed.
 */
async function resolveTickers(
  prisma: PrismaClient,
  filings: ScrapedPtrFiling[],
): Promise<{
  resolved: Map<string, { entityId: string; identifier: string; subcategory: string | null; filings: ScrapedPtrFiling[] }>
  unresolved: ScrapedPtrFiling[]
}> {
  const tickers = new Set<string>()
  for (const f of filings) if (f.ticker) tickers.add(f.ticker.toUpperCase())

  const entities = tickers.size
    ? await prisma.trackedEntity.findMany({
        where: { identifier: { in: Array.from(tickers) }, active: true },
        select: { id: true, identifier: true, subcategory: true },
      })
    : []
  const byTicker = new Map(entities.map((e) => [e.identifier.toUpperCase(), e]))

  const resolved = new Map<string, { entityId: string; identifier: string; subcategory: string | null; filings: ScrapedPtrFiling[] }>()
  const unresolved: ScrapedPtrFiling[] = []
  for (const f of filings) {
    if (!f.ticker) {
      // No ticker parseable — can't resolve, but also not a "missing entity"
      // audit signal. Skip quietly.
      continue
    }
    const tick = f.ticker.toUpperCase()
    const entity = byTicker.get(tick)
    if (!entity) {
      unresolved.push(f)
      continue
    }
    const bucket = resolved.get(entity.id) ?? {
      entityId: entity.id,
      identifier: entity.identifier,
      subcategory: entity.subcategory,
      filings: [] as ScrapedPtrFiling[],
    }
    bucket.filings.push(f)
    resolved.set(entity.id, bucket)
  }
  return { resolved, unresolved }
}

async function logUnresolvedTickers(
  prisma: PrismaClient,
  unresolved: ScrapedPtrFiling[],
): Promise<void> {
  if (unresolved.length === 0) return
  await prisma.costLog.createMany({
    data: unresolved.map((f) => ({
      model: 'trigger_runner',
      agentType: 'trigger_unmatched_filing',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: 'trigger',
      operation: 'congressional-trade-unmatched-ticker',
      metadata: {
        triggerId: TRIGGER_ID,
        ticker: f.ticker,
        member: f.member,
        chamber: f.chamber,
        filing_url: f.filingUrl,
        disclosure_id: f.disclosureId,
      },
    })),
  })
}

/**
 * Count how many DISTINCT members traded this ticker within a 30-day
 * window ending now. Used for the multi-member elevation condition.
 */
function countDistinctMembers(filings: ScrapedPtrFiling[], now: Date): number {
  const cutoff = new Date(now.getTime() - MULTI_MEMBER_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const recent = filings.filter((f) => {
    if (!f.disclosedAt) return true // treat unknown date as recent (permissive)
    return new Date(f.disclosedAt) >= cutoff
  })
  return new Set(recent.map((f) => f.member.toLowerCase())).size
}

function directionFromTransactions(filings: ScrapedPtrFiling[]): number {
  let buys = 0
  let sells = 0
  for (const f of filings) {
    if (f.transactionType === 'purchase') buys++
    else if (f.transactionType === 'sale') sells++
  }
  if (buys === 0 && sells === 0) return 0
  if (buys > sells) return 1
  if (sells > buys) return -1
  return 0
}

export async function congressionalTradeTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const cursor = await readCursor(ctx.prisma)
  const sinceDate = cursor
    ? new Date(cursor)
    : new Date(ctx.now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  let houseResult: { filings: ScrapedPtrFiling[]; skippedRows: number }
  let senateResult: { filings: ScrapedPtrFiling[]; skippedRows: number }
  const errors: string[] = []

  try {
    houseResult = await fetchHousePtrs(sinceDate)
  } catch (err) {
    errors.push(`house: ${err instanceof Error ? err.message : String(err)}`)
    houseResult = { filings: [], skippedRows: 0 }
  }
  try {
    senateResult = await fetchSenatePtrs(sinceDate)
  } catch (err) {
    errors.push(`senate: ${err instanceof Error ? err.message : String(err)}`)
    senateResult = { filings: [], skippedRows: 0 }
  }

  const filings = [...houseResult.filings, ...senateResult.filings]

  if (errors.length > 0) {
    await writeHeartbeat(ctx.prisma, 'failure', {
      errors,
      house_count: houseResult.filings.length,
      senate_count: senateResult.filings.length,
    })
  } else if (filings.length === 0) {
    await writeHeartbeat(ctx.prisma, 'empty', {
      house_skipped: houseResult.skippedRows,
      senate_skipped: senateResult.skippedRows,
      since: sinceDate.toISOString(),
    })
    return []
  } else {
    await writeHeartbeat(ctx.prisma, 'success', {
      house_count: houseResult.filings.length,
      senate_count: senateResult.filings.length,
      house_skipped: houseResult.skippedRows,
      senate_skipped: senateResult.skippedRows,
    })
  }

  const { resolved, unresolved } = await resolveTickers(ctx.prisma, filings)
  await logUnresolvedTickers(ctx.prisma, unresolved)

  const fires: TriggerFireEvent[] = []
  for (const [entityId, group] of resolved.entries()) {
    let severity = 0.4
    const elevations: string[] = []

    // Elevation: any filing with amount-bucket low > $50K
    const highValue = group.filings.some(
      (f) => f.amountBucket !== null && f.amountBucket.low >= HIGH_VALUE_THRESHOLD_USD,
    )
    if (highValue) {
      severity += 0.2
      elevations.push('high_value')
    }

    // Elevation: ≥2 distinct members in 30d window
    if (countDistinctMembers(group.filings, ctx.now) >= MULTI_MEMBER_FLOOR) {
      severity += 0.2
      elevations.push('multi_member')
    }

    // Committee-jurisdiction elevation: needs full member committee data we
    // don't scrape yet in 1c.2a. Hook is wired: when a future PR adds
    // committee assignment scraping, set a boolean here.
    // (If you add committee data later, extend elevations with 'committee_match'.)

    severity = Math.min(severity, 1.0)

    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity,
      metadata: {
        identifier: group.identifier,
        filing_count: group.filings.length,
        members: Array.from(new Set(group.filings.map((f) => f.member))).slice(0, 10),
        chambers: Array.from(new Set(group.filings.map((f) => f.chamber))),
        elevations,
        direction: directionFromTransactions(group.filings),
        filings: group.filings.map((f) => ({
          chamber: f.chamber,
          member: f.member,
          transactionType: f.transactionType,
          disclosedAt: f.disclosedAt,
          amount_low: f.amountBucket?.low ?? null,
          amount_high: f.amountBucket?.high ?? null,
          filingUrl: f.filingUrl,
        })),
      },
    })
  }

  // Advance cursor to max disclosedAt seen (if any).
  let maxDisclosed: string | null = null
  for (const f of filings) {
    if (!f.disclosedAt) continue
    if (!maxDisclosed || f.disclosedAt > maxDisclosed) maxDisclosed = f.disclosedAt
  }
  if (maxDisclosed) await writeCursor(ctx.prisma, maxDisclosed)

  return fires
}
