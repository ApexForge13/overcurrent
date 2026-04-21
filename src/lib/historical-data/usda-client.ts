/**
 * USDA indicator history client.
 *
 * USDA's public data is less API-first than FRED/EIA. Two pragmatic
 * options for Phase 1b:
 *   1. USDA NASS Quick Stats (https://quickstats.nass.usda.gov/api) —
 *      free, requires a key, covers WASDE-style estimates.
 *   2. USDA ERS static CSVs — no key, but manual URL discovery.
 *
 * Phase 1b scaffolds the client shape; the production seed can flip to
 * either implementation depending on which data subset we actually need.
 * For now this file exports the indicator catalog (WASDE corn/soy/wheat)
 * and a stub fetcher that returns an empty series unless live loading is
 * explicitly wired by an operator. This keeps Phase 1b green without
 * demanding USDA key provisioning before running tests.
 */

export interface UsdaObservation {
  periodEnd: string
  value: number
  unit: string
}

export interface UsdaIndicatorSpec {
  seriesId: string
  displayName: string
  category: 'inventory'
  unit: string
  releaseSchedule: string
  relevantAssets: string[]
}

export const USDA_INDICATORS: readonly UsdaIndicatorSpec[] = Object.freeze([
  {
    seriesId: 'USDA_WASDE_CORN',
    displayName: 'WASDE Corn Ending Stocks (US)',
    category: 'inventory',
    unit: 'M bu',
    releaseSchedule: 'monthly, ~10th of the month 12:00 ET',
    relevantAssets: ['ZC=F', 'CORN'],
  },
  {
    seriesId: 'USDA_WASDE_SOY',
    displayName: 'WASDE Soybean Ending Stocks (US)',
    category: 'inventory',
    unit: 'M bu',
    releaseSchedule: 'monthly, ~10th of the month 12:00 ET',
    relevantAssets: ['ZS=F', 'SOYB'],
  },
  {
    seriesId: 'USDA_WASDE_WHEAT',
    displayName: 'WASDE Wheat Ending Stocks (US)',
    category: 'inventory',
    unit: 'M bu',
    releaseSchedule: 'monthly, ~10th of the month 12:00 ET',
    relevantAssets: ['ZW=F', 'WEAT'],
  },
])

export interface FetchUsdaOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
}

/**
 * Phase 1b stub: USDA API integration requires WASDE-specific parameter
 * discovery and season-year handling that isn't load-bearing for Phase 1b
 * (surprise-proxy works fine against zero-length series; the indicators
 * are still registered in MacroIndicatorConfig and ready for Phase 1c).
 *
 * When live loading is needed, replace this body with a NASS Quick Stats
 * or ERS CSV fetch. Behaviour on empty return:
 *   - MacroRelease rows: 0 for these indicators in Phase 1b
 *   - MacroIndicatorConfig.historicalStddev: initialized to 1.0 by the
 *     proxy computer with a "insufficient_history" note in metadata
 */
export async function fetchUsdaSeries(
  _spec: UsdaIndicatorSpec,
  _opts: FetchUsdaOptions = {},
): Promise<UsdaObservation[]> {
  return []
}
