/**
 * Map from internal MacroIndicatorConfig.indicator IDs to scraper URL slugs.
 *
 * Investing.com uses numeric-suffixed slugs (e.g., `nonfarm-payrolls-227`);
 * Trading Economics uses plain calendar keys (e.g., `non-farm-payrolls`).
 * Both are stable over long periods but may rev when the site refactors —
 * if a scrape starts returning empty for a specific indicator, verify the
 * slug here first.
 *
 * Not every seeded indicator is covered (USDA crop indicators have no
 * clean calendar presence). Uncovered indicators are skipped silently by
 * the scraper worker.
 */

export interface IndicatorSlugs {
  /** Investing.com calendar path fragment after /economic-calendar/ */
  investing?: string
  /** Trading Economics calendar key (query param value) */
  tradingEconomics?: string
}

export const INDICATOR_SLUG_MAP: Record<string, IndicatorSlugs> = {
  // FRED — employment
  PAYEMS: { investing: 'nonfarm-payrolls-227', tradingEconomics: 'non-farm-payrolls' },
  UNRATE: { investing: 'unemployment-rate-300', tradingEconomics: 'unemployment-rate' },
  ICSA: { investing: 'initial-jobless-claims-294', tradingEconomics: 'initial-jobless-claims' },
  CIVPART: { investing: 'participation-rate-372', tradingEconomics: 'labor-force-participation-rate' },
  CES0500000003: { investing: 'average-hourly-earnings-mom-8', tradingEconomics: 'average-hourly-earnings' },

  // FRED — inflation
  CPIAUCSL: { investing: 'cpi-733', tradingEconomics: 'consumer-price-index-cpi' },
  CPILFESL: { investing: 'core-cpi-736', tradingEconomics: 'core-consumer-prices' },
  PPIACO: { investing: 'ppi-238', tradingEconomics: 'producer-prices' },

  // FRED — growth
  RSAFS: { investing: 'retail-sales-mom-256', tradingEconomics: 'retail-sales' },
  INDPRO: { investing: 'industrial-production-161', tradingEconomics: 'industrial-production' },
  IPMAN: { investing: 'manufacturing-production-1769', tradingEconomics: 'manufacturing-production' },
  GDPC1: { investing: 'gdp-qoq-375', tradingEconomics: 'gdp-growth-rate' },
  HOUST: { investing: 'housing-starts-151', tradingEconomics: 'housing-starts' },

  // FRED — sentiment / monetary
  UMCSENT: { investing: 'michigan-consumer-sentiment-320', tradingEconomics: 'consumer-sentiment' },
  FEDFUNDS: { investing: 'fed-interest-rate-decision-168', tradingEconomics: 'interest-rate' },

  // EIA — inventory
  EIA_CRUDE: { investing: 'crude-oil-inventories-75', tradingEconomics: 'crude-oil-stocks-change' },
  EIA_NATGAS: { investing: 'natural-gas-storage-386', tradingEconomics: 'natural-gas-stocks-change' },

  // USDA slugs omitted — Trading Economics covers them sparsely; add
  // selectively when a specific trigger firing demands it.
}

/** Return all indicator IDs that have at least one scrape target configured. */
export function scrapeableIndicators(): string[] {
  return Object.entries(INDICATOR_SLUG_MAP)
    .filter(([, slugs]) => slugs.investing || slugs.tradingEconomics)
    .map(([id]) => id)
}
