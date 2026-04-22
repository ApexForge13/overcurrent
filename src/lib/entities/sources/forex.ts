/**
 * Forex pair catalog — 20 hardcoded pairs per Phase 1c amendment.
 *
 * Scope:
 *   - G10 majors (7): EUR/USD, USD/JPY, GBP/USD, USD/CHF, AUD/USD, USD/CAD, NZD/USD
 *   - Crosses (4):    EUR/JPY, EUR/GBP, GBP/JPY, AUD/JPY
 *   - Emerging (7):   USD/CNY, USD/INR, USD/BRL, USD/MXN, USD/ZAR, USD/TRY, USD/SGD
 *   - Metals (2):     XAU/USD (gold spot), XAG/USD (silver spot)
 *
 * Identifier format: slash form (e.g., "EUR/USD"). providerIds.fxSymbol
 * stores the no-slash form ("EURUSD") for matching against data feeds that
 * use one convention or the other. entityStrings.aliases carries both plus
 * common human names ("Euro", "Cable" for GBP/USD, "Gold spot" for XAU/USD).
 *
 * Applicable triggers (forex has no SEC filings, Congress trades, COT):
 *   T-GT5 (intraday move), T-GT6 (overnight gap), T-GT9 (macro surprise).
 */

import type { TrackedEntityInput } from '../types'

interface ForexSpec {
  pair: string // slash form: "EUR/USD"
  name: string
  subcategory: 'g10_major' | 'cross' | 'emerging' | 'metal_spot'
  aliases: string[]
}

const FX_TRIGGERS = Object.freeze(['T-GT5', 'T-GT6', 'T-GT9'])

export const FOREX_CATALOG: readonly ForexSpec[] = Object.freeze([
  // G10 majors
  { pair: 'EUR/USD', name: 'Euro / US Dollar',                subcategory: 'g10_major', aliases: ['Euro', 'EURUSD'] },
  { pair: 'USD/JPY', name: 'US Dollar / Japanese Yen',        subcategory: 'g10_major', aliases: ['Yen', 'USDJPY'] },
  { pair: 'GBP/USD', name: 'British Pound / US Dollar',       subcategory: 'g10_major', aliases: ['Cable', 'Pound', 'GBPUSD'] },
  { pair: 'USD/CHF', name: 'US Dollar / Swiss Franc',         subcategory: 'g10_major', aliases: ['Swissie', 'Franc', 'USDCHF'] },
  { pair: 'AUD/USD', name: 'Australian Dollar / US Dollar',   subcategory: 'g10_major', aliases: ['Aussie', 'AUDUSD'] },
  { pair: 'USD/CAD', name: 'US Dollar / Canadian Dollar',     subcategory: 'g10_major', aliases: ['Loonie', 'USDCAD'] },
  { pair: 'NZD/USD', name: 'New Zealand Dollar / US Dollar',  subcategory: 'g10_major', aliases: ['Kiwi', 'NZDUSD'] },
  // Crosses
  { pair: 'EUR/JPY', name: 'Euro / Japanese Yen',             subcategory: 'cross',     aliases: ['EURJPY'] },
  { pair: 'EUR/GBP', name: 'Euro / British Pound',            subcategory: 'cross',     aliases: ['EURGBP'] },
  { pair: 'GBP/JPY', name: 'British Pound / Japanese Yen',    subcategory: 'cross',     aliases: ['Guppy', 'GBPJPY'] },
  { pair: 'AUD/JPY', name: 'Australian Dollar / Japanese Yen',subcategory: 'cross',     aliases: ['AUDJPY'] },
  // Emerging
  { pair: 'USD/CNY', name: 'US Dollar / Chinese Yuan',        subcategory: 'emerging',  aliases: ['Yuan', 'USDCNY'] },
  { pair: 'USD/INR', name: 'US Dollar / Indian Rupee',        subcategory: 'emerging',  aliases: ['Rupee', 'USDINR'] },
  { pair: 'USD/BRL', name: 'US Dollar / Brazilian Real',      subcategory: 'emerging',  aliases: ['Real', 'USDBRL'] },
  { pair: 'USD/MXN', name: 'US Dollar / Mexican Peso',        subcategory: 'emerging',  aliases: ['Peso', 'USDMXN'] },
  { pair: 'USD/ZAR', name: 'US Dollar / South African Rand',  subcategory: 'emerging',  aliases: ['Rand', 'USDZAR'] },
  { pair: 'USD/TRY', name: 'US Dollar / Turkish Lira',        subcategory: 'emerging',  aliases: ['Lira', 'USDTRY'] },
  // Phase 1c.2a: 20th pair — MAS-managed basket gives cleaner Asia signal
  // than USD/HKD's hard peg (which barely moves except under extreme stress).
  { pair: 'USD/SGD', name: 'US Dollar / Singapore Dollar',    subcategory: 'emerging',  aliases: ['Singapore Dollar', 'USDSGD', 'Sing Dollar'] },
  // Metals (spot, priced in USD)
  { pair: 'XAU/USD', name: 'Gold Spot (USD)',                 subcategory: 'metal_spot',aliases: ['Gold spot', 'XAUUSD'] },
  { pair: 'XAG/USD', name: 'Silver Spot (USD)',               subcategory: 'metal_spot',aliases: ['Silver spot', 'XAGUSD'] },
])

export function loadForexEntities(): TrackedEntityInput[] {
  return FOREX_CATALOG.map((spec) => {
    const noSlash = spec.pair.replace('/', '')
    return {
      identifier: spec.pair,
      name: spec.name,
      category: 'fx' as const,
      subcategory: spec.subcategory,
      providerIds: {
        fxSymbol: noSlash,
      },
      groundTruthMap: {
        applicableTriggers: [...FX_TRIGGERS],
      },
      entityStrings: {
        aliases: Array.from(
          new Set([spec.pair, noSlash, spec.name, `$${noSlash}`, ...spec.aliases]),
        ),
      },
    }
  })
}
