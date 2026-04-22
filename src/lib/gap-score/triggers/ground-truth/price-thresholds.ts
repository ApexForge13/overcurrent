/**
 * Per-category price-move thresholds for T-GT5 (intraday) and T-GT6 (gap).
 *
 * From Phase 1 addendum A1.4:
 *   T-GT5 intraday  — Equity 3% / Commodity 2% / Crypto 5%
 *   T-GT6 overnight — Equity 2% / Commodity 1% / Crypto 4%
 *
 * Exported as a function so trigger code can apply TriggerEnablement
 * thresholdOverrides merges uniformly: overrides come in as a loose
 * Record<string, number>, getIntradayThreshold merges before returning.
 */

export type PriceCategory = 'equity' | 'etf' | 'commodity' | 'crypto'

const INTRADAY_DEFAULTS: Record<PriceCategory, number> = {
  equity: 0.03,
  etf: 0.03,
  commodity: 0.02,
  crypto: 0.05,
}

const OVERNIGHT_DEFAULTS: Record<PriceCategory, number> = {
  equity: 0.02,
  etf: 0.02,
  commodity: 0.01,
  crypto: 0.04,
}

export function getIntradayThreshold(
  category: string,
  overrides?: Record<string, number> | null,
): number {
  const defaults = INTRADAY_DEFAULTS[category as PriceCategory] ?? INTRADAY_DEFAULTS.equity
  const overrideKey = `intraday_${category}_pct`
  if (overrides && typeof overrides[overrideKey] === 'number') {
    return overrides[overrideKey]
  }
  return defaults
}

export function getOvernightThreshold(
  category: string,
  overrides?: Record<string, number> | null,
): number {
  const defaults = OVERNIGHT_DEFAULTS[category as PriceCategory] ?? OVERNIGHT_DEFAULTS.equity
  const overrideKey = `overnight_${category}_pct`
  if (overrides && typeof overrides[overrideKey] === 'number') {
    return overrides[overrideKey]
  }
  return defaults
}

/**
 * Bucket a category string into a PriceCategory or 'equity' as fallback.
 */
export function resolvePriceCategory(raw: string): PriceCategory {
  if (raw === 'etf' || raw === 'commodity' || raw === 'crypto') return raw
  return 'equity'
}
