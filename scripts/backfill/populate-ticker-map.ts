/**
 * TickerEntityMap populator — SEC EDGAR company tickers backfill.
 *
 * Pulls the SEC's public ticker-to-CIK registry
 * (https://www.sec.gov/files/company_tickers.json) and populates the
 * TickerEntityMap table. For each row:
 *   1. Upserts an Entity with type='company' and slug=`company--<slug(name)>`
 *   2. Upserts a TickerEntityMap row with ticker → entityId
 *
 * Idempotent — safe to run weekly. Upserts on ticker uniqueness and
 * entity slug uniqueness.
 *
 * Run: npx tsx scripts/backfill/populate-ticker-map.ts
 *
 * Usage notes:
 *   - SEC requires a User-Agent header identifying the requester. We send
 *     `Overcurrent/1.0 connermhecht13@gmail.com` — change via env var
 *     SEC_EDGAR_USER_AGENT if needed.
 *   - No API key required.
 *   - Rate limit: ~10 req/sec. We make a single request for the full registry.
 *   - Registry size: ~12,000 companies.
 */

import 'dotenv/config'
import { prisma } from '../../src/lib/db'
import { slugifyEntityName } from '../../src/lib/publish-hooks/entity-extraction'

const SEC_TICKER_URL = 'https://www.sec.gov/files/company_tickers.json'
const USER_AGENT = process.env.SEC_EDGAR_USER_AGENT ?? 'Overcurrent/1.0 connermhecht13@gmail.com'

interface SecTickerEntry {
  cik_str: number
  ticker: string
  title: string
}

// SEC returns an object keyed by numeric index: { "0": {cik_str, ticker, title}, ... }
type SecTickerPayload = Record<string, SecTickerEntry>

async function fetchSecTickers(): Promise<SecTickerEntry[]> {
  const res = await fetch(SEC_TICKER_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`SEC EDGAR returned ${res.status}: ${res.statusText}`)
  }
  const json = (await res.json()) as SecTickerPayload
  return Object.values(json)
}

async function main() {
  console.log('\n━━━ SEC EDGAR TICKER MAP BACKFILL ━━━')
  console.log(`Fetching ${SEC_TICKER_URL}`)

  const started = Date.now()
  const entries = await fetchSecTickers()
  console.log(`Loaded ${entries.length.toLocaleString()} ticker entries from SEC`)

  let entitiesCreated = 0
  let entitiesUpdated = 0
  let tickersCreated = 0
  let tickersUpdated = 0
  let errors = 0

  let progress = 0
  const progressStep = Math.max(1, Math.floor(entries.length / 20))

  for (const entry of entries) {
    progress++
    if (progress % progressStep === 0) {
      console.log(
        `[${Math.round((progress / entries.length) * 100)}%] ${progress}/${entries.length} — entities=${entitiesCreated}c/${entitiesUpdated}u tickers=${tickersCreated}c/${tickersUpdated}u errors=${errors}`,
      )
    }

    const ticker = entry.ticker?.trim().toUpperCase()
    const name = entry.title?.trim()
    if (!ticker || !name) continue

    try {
      const slug = slugifyEntityName(name, 'company')

      // Upsert Entity
      const entityResult = await prisma.entity.upsert({
        where: { slug },
        create: {
          name,
          type: 'company',
          slug,
          description: `Publicly traded company (SEC ticker ${ticker}, CIK ${entry.cik_str})`,
          isPublic: true,
        },
        update: {
          // Keep the existing description if we already have a richer one.
          // Only backfill a description if it's null.
          ...(entry.cik_str ? {} : {}),
        },
        select: { id: true, createdAt: true, updatedAt: true },
      })
      const wasCreated = entityResult.createdAt.getTime() === entityResult.updatedAt.getTime()
      if (wasCreated) entitiesCreated++
      else entitiesUpdated++

      // Upsert TickerEntityMap
      const tickerExisting = await prisma.tickerEntityMap.findUnique({ where: { ticker } })
      await prisma.tickerEntityMap.upsert({
        where: { ticker },
        create: {
          ticker,
          entityId: entityResult.id,
          exchangeName: 'US_EDGAR', // SEC EDGAR registry — no exchange-level disambiguation
        },
        update: {
          entityId: entityResult.id,
        },
      })
      if (tickerExisting) tickersUpdated++
      else tickersCreated++
    } catch (err) {
      errors++
      if (errors <= 5) {
        console.warn(
          `[populate-ticker-map] Failed for ${ticker} (${name}):`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log('\n━━━ SUMMARY ━━━')
  console.log(`Entities:  ${entitiesCreated.toLocaleString()} created, ${entitiesUpdated.toLocaleString()} updated`)
  console.log(`Tickers:   ${tickersCreated.toLocaleString()} created, ${tickersUpdated.toLocaleString()} updated`)
  console.log(`Errors:    ${errors.toLocaleString()}`)
  console.log(`Elapsed:   ${elapsed}s`)
  console.log()
}

main()
  .catch((err) => {
    console.error('[populate-ticker-map] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
