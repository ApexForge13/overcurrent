/**
 * CoinGecko source loader — top N crypto by market cap.
 *
 * Free tier: 250 per page, rate-limited to ~30 calls/min. Phase 1b caps at
 * top 1,000 (4 pages) per user decision — covers 99%+ of meaningful trading
 * volume without triggering rate limits. Expand to 5K when we hit a paid
 * CoinGecko tier.
 *
 * Stable-coins and wrapped tokens are kept (not filtered). They're genuine
 * signal-eligible assets — narrative divergences on USDT or stETH are
 * signals worth flagging.
 */

import type { TrackedEntityInput } from '../types'

const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets'

interface CoinGeckoMarketRow {
  id: string
  symbol: string
  name: string
  market_cap_rank: number | null
  market_cap: number | null
}

const CRYPTO_TRIGGERS = Object.freeze([
  'T-GT5', // intraday price move
  'T-GT6', // overnight price gap
  // T-GT1/2/3/10/11 don't apply to crypto (no SEC filings, no Congress trades)
])

export interface LoadCoinGeckoOptions {
  /** Max coins to return. Defaults to 1000 (4 pages × 250). */
  limit?: number
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Seconds to wait between page calls; defaults to 6 (free tier ~10/min). */
  pageDelaySeconds?: number
}

export async function loadCoinGeckoEntities(
  opts: LoadCoinGeckoOptions = {},
): Promise<TrackedEntityInput[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const limit = Math.max(1, Math.min(opts.limit ?? 1000, 10000))
  const perPage = 250
  const pages = Math.ceil(limit / perPage)
  const delayMs = (opts.pageDelaySeconds ?? 6) * 1000

  const rows: CoinGeckoMarketRow[] = []
  for (let page = 1; page <= pages; page++) {
    const url = new URL(COINGECKO_MARKETS_URL)
    url.searchParams.set('vs_currency', 'usd')
    url.searchParams.set('order', 'market_cap_desc')
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('page', String(page))
    url.searchParams.set('sparkline', 'false')

    const resp = await fetchImpl(url.toString(), {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) {
      // 429 = rate-limited; surface as a retryable error for the orchestrator.
      throw new Error(`CoinGecko fetch failed (page ${page}): ${resp.status} ${resp.statusText}`)
    }
    const batch = (await resp.json()) as CoinGeckoMarketRow[]
    if (!Array.isArray(batch)) break
    rows.push(...batch)
    if (batch.length < perPage) break
    if (page < pages) await sleep(delayMs)
  }

  return parseCoinGeckoResponse(rows).slice(0, limit)
}

export function parseCoinGeckoResponse(
  rows: CoinGeckoMarketRow[],
): TrackedEntityInput[] {
  const seenSymbols = new Set<string>()
  const out: TrackedEntityInput[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!symbol || !name || !id) continue
    // Dedupe: tokens occasionally share symbols (e.g., two "BAT"s). Keep the
    // higher-rank (earlier) entry — downstream matching uses the CoinGecko
    // id as the source of truth anyway.
    if (seenSymbols.has(symbol)) continue
    seenSymbols.add(symbol)
    out.push({
      identifier: symbol,
      name,
      category: 'crypto',
      providerIds: {
        coingeckoId: id,
        coingeckoRank: row.market_cap_rank ?? undefined,
        cryptoSymbol: symbol.toLowerCase(),
      },
      groundTruthMap: {
        applicableTriggers: [...CRYPTO_TRIGGERS],
      },
      entityStrings: {
        aliases: Array.from(new Set([symbol, name, `$${symbol}`, `#${symbol}`])),
      },
    })
  }
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
