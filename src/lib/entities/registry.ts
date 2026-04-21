/**
 * Orchestrator — pulls from all six sources, dedupes, upserts.
 *
 * Dedup rule: the LAST source to emit a given identifier wins. Order matters:
 *   1. SEC (baseline universe of ~10K equities + some ETFs)
 *   2. CoinGecko (crypto — no overlap with SEC)
 *   3. Futures (distinct =F-suffixed identifiers — no overlap)
 *   4. ETFs (overrides SEC's 'equity' default with 'etf' for SPY/QQQ/etc.)
 *   5. Forex (distinct slash-form identifiers — no overlap)
 *   6. Yields (distinct DGSx / IRLTLT01x identifiers — no overlap)
 *
 * The orchestrator tolerates partial source failure — if CoinGecko is down
 * the seed still lands the other sources, with a warning logged. This is
 * intentional: a one-off seed shouldn't bail because a third-party API
 * hiccupped mid-run.
 */

import { loadSecEntities, type LoadSecOptions } from './sources/sec'
import { loadCoinGeckoEntities, type LoadCoinGeckoOptions } from './sources/coingecko'
import { loadFuturesEntities } from './sources/futures'
import { loadEtfEntities } from './sources/etfs'
import { loadForexEntities } from './sources/forex'
import { loadYieldEntities } from './sources/yields'
import type { TrackedEntityInput } from './types'

export interface LoadRegistryOptions {
  sec?: LoadSecOptions | false
  coingecko?: LoadCoinGeckoOptions | false
  futures?: boolean
  etfs?: boolean
  forex?: boolean
  yields?: boolean
  /** Called once per source with status info — useful for CLI progress. */
  onProgress?: (event: RegistryProgressEvent) => void
}

export type RegistryProgressEvent =
  | { source: string; status: 'started' }
  | { source: string; status: 'success'; count: number }
  | { source: string; status: 'skipped'; reason: string }
  | { source: string; status: 'failed'; error: string }

export interface LoadRegistryResult {
  entities: TrackedEntityInput[]
  bySource: Record<string, number>
  duplicatesOverridden: number
}

export async function loadEntityRegistry(
  opts: LoadRegistryOptions = {},
): Promise<LoadRegistryResult> {
  const emit = opts.onProgress ?? (() => {})
  const bySource: Record<string, number> = {
    sec: 0,
    coingecko: 0,
    futures: 0,
    etfs: 0,
    forex: 0,
    yields: 0,
  }
  const accumulator = new Map<string, { entity: TrackedEntityInput; source: string }>()
  let duplicatesOverridden = 0

  async function runSource(
    source: string,
    run: () => Promise<TrackedEntityInput[]> | TrackedEntityInput[],
  ) {
    emit({ source, status: 'started' })
    try {
      const results = await Promise.resolve(run())
      bySource[source] = results.length
      for (const entity of results) {
        const prior = accumulator.get(entity.identifier)
        if (prior) duplicatesOverridden++
        accumulator.set(entity.identifier, { entity, source })
      }
      emit({ source, status: 'success', count: results.length })
    } catch (err) {
      emit({
        source,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (opts.sec !== false) {
    await runSource('sec', () => loadSecEntities(opts.sec || {}))
  } else {
    emit({ source: 'sec', status: 'skipped', reason: 'disabled by options' })
  }
  if (opts.coingecko !== false) {
    await runSource('coingecko', () => loadCoinGeckoEntities(opts.coingecko || {}))
  } else {
    emit({ source: 'coingecko', status: 'skipped', reason: 'disabled by options' })
  }
  if (opts.futures !== false) {
    await runSource('futures', () => loadFuturesEntities())
  } else {
    emit({ source: 'futures', status: 'skipped', reason: 'disabled by options' })
  }
  if (opts.etfs !== false) {
    await runSource('etfs', () => loadEtfEntities())
  } else {
    emit({ source: 'etfs', status: 'skipped', reason: 'disabled by options' })
  }
  if (opts.forex !== false) {
    await runSource('forex', () => loadForexEntities())
  } else {
    emit({ source: 'forex', status: 'skipped', reason: 'disabled by options' })
  }
  if (opts.yields !== false) {
    await runSource('yields', () => loadYieldEntities())
  } else {
    emit({ source: 'yields', status: 'skipped', reason: 'disabled by options' })
  }

  return {
    entities: Array.from(accumulator.values()).map((v) => v.entity),
    bySource,
    duplicatesOverridden,
  }
}
