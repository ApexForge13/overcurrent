/**
 * CoinGecko source loader — top N crypto by market cap.
 *
 * Free tier rate-limit reality: observed consistent 429s on page 4 during
 * Phase 1c seed despite 6s inter-page delays. Tightening delay alone
 * didn't resolve — the free tier appears to have a short rolling-window
 * cap that triggers after ~3 consecutive calls. Solution: explicit
 * retry-on-429 with exponential backoff (30s → 60s → 120s, max 3 retries)
 * + longer default inter-page delay (15s). When retry-after header is
 * present, honor it instead.
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
  /** Seconds to wait between page calls; defaults to 15 (free-tier safe). */
  pageDelaySeconds?: number
  /** Max retries on 429; defaults to 3. */
  maxRetries?: number
}

const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000] // 30s, 60s, 120s

export async function loadCoinGeckoEntities(
  opts: LoadCoinGeckoOptions = {},
): Promise<TrackedEntityInput[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const limit = Math.max(1, Math.min(opts.limit ?? 1000, 10000))
  const perPage = 250
  const pages = Math.ceil(limit / perPage)
  const delayMs = (opts.pageDelaySeconds ?? 15) * 1000
  const maxRetries = Math.max(0, opts.maxRetries ?? 3)

  const rows: CoinGeckoMarketRow[] = []
  for (let page = 1; page <= pages; page++) {
    const url = new URL(COINGECKO_MARKETS_URL)
    url.searchParams.set('vs_currency', 'usd')
    url.searchParams.set('order', 'market_cap_desc')
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('page', String(page))
    url.searchParams.set('sparkline', 'false')

    const batch = await fetchPageWithRetry(url.toString(), fetchImpl, page, maxRetries)
    if (!Array.isArray(batch)) break
    rows.push(...batch)
    if (batch.length < perPage) break
    if (page < pages) await sleep(delayMs)
  }

  return parseCoinGeckoResponse(rows).slice(0, limit)
}

async function fetchPageWithRetry(
  url: string,
  fetchImpl: typeof fetch,
  page: number,
  maxRetries: number,
): Promise<CoinGeckoMarketRow[]> {
  let attempt = 0
  while (true) {
    const resp = await fetchImpl(url, { headers: { Accept: 'application/json' } })
    if (resp.ok) {
      return (await resp.json()) as CoinGeckoMarketRow[]
    }
    // Rate-limit path — retry with Retry-After if provided, else exponential backoff.
    if (resp.status === 429 && attempt < maxRetries) {
      const retryAfterHdr = resp.headers.get('retry-after')
      const retryAfterMs = retryAfterHdr
        ? Math.max(1000, Number(retryAfterHdr) * 1000)
        : (RETRY_BACKOFF_MS[attempt] ?? 120_000)
      console.warn(
        `[coingecko] 429 on page ${page} (attempt ${attempt + 1}/${maxRetries + 1}); waiting ${Math.round(retryAfterMs / 1000)}s`,
      )
      await sleep(retryAfterMs)
      attempt++
      continue
    }
    // Non-retryable or out-of-retries — surface the error for orchestrator.
    throw new Error(
      `CoinGecko fetch failed (page ${page}, attempts ${attempt + 1}): ${resp.status} ${resp.statusText}`,
    )
  }
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
