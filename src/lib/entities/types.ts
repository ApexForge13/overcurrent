/**
 * Shared types for the TrackedEntity registry + its data sources.
 *
 * The TrackedEntity table has three open-shape JSON fields — `providerIds`,
 * `groundTruthMap`, `entityStrings` — that different sources fill in
 * differently. These interfaces pin the canonical shape so source loaders
 * and downstream readers stay in sync.
 */

export type EntityCategory = 'equity' | 'commodity' | 'crypto' | 'etf' | 'fx'

export interface ProviderIds {
  /** SEC Central Index Key — equities + ETFs */
  cik?: string
  /** CoinGecko ID — crypto */
  coingeckoId?: string
  /** CoinGecko market-cap rank at seed time — crypto */
  coingeckoRank?: number
  /** CME Globex symbol — commodity futures */
  cmeSymbol?: string
  /** ICE contract code — commodity futures (non-CME) */
  iceSymbol?: string
  /** CoinGecko symbol (e.g., "btc") — crypto */
  cryptoSymbol?: string
  /** Exchange ticker suffix (e.g., ".O" for Nasdaq, "=F" for futures) */
  tickerSuffix?: string
}

export interface GroundTruthMap {
  /**
   * Which ground-truth trigger types (per Phase 1 addendum A1.4) apply to
   * this entity. Used by the candidate generator to avoid evaluating
   * irrelevant triggers. Seeded per-category in Phase 1b; refined in 1c.
   */
  applicableTriggers: string[]
}

export interface EntityStrings {
  /**
   * Alternative names for NLP entity matching. Ticker, full company name,
   * common short forms, cashtag variants.
   */
  aliases: string[]
}

/** Canonical shape source loaders produce — orchestrator upserts into TrackedEntity. */
export interface TrackedEntityInput {
  identifier: string
  name: string
  category: EntityCategory
  subcategory?: string
  providerIds: ProviderIds
  groundTruthMap: GroundTruthMap
  entityStrings: EntityStrings
  isFeatured?: boolean
}
