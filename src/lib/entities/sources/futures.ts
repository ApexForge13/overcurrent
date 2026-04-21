/**
 * CME/ICE commodity futures — hardcoded contract catalog.
 *
 * Rationale for hardcoding (per Phase 1b manifest Ambiguity F):
 *   - CME/ICE don't publish machine-readable specs for free.
 *   - Scraping Globex is ToS-adjacent and fragile.
 *   - Our featured set + broad commodity universe is ~100 contracts.
 *   - Hardcoded = zero maintenance, zero external dep.
 *
 * Scope covers:
 *   Energy (CL, BZ, NG, HO, RB), metals (GC, SI, HG, PL, PA), grains (ZW,
 *   ZC, ZS, ZL, ZM, ZO), softs (CC, KC, CT, SB, OJ), livestock (LE, GF, HE),
 *   equity index futures (ES, NQ, YM, RTY), Treasury futures (ZB, ZN, ZT,
 *   ZF), FX futures (6E, 6J, 6B, 6A, 6C, 6S), AND crypto futures on CME
 *   (MBT for Bitcoin micro, MET for Ether micro) — per user's Phase 1b
 *   refinement: crypto futures are the institutional hedge instrument and
 *   a useful divergence signal between crypto spot and CME positioning.
 *
 * Adding new contracts later: append to FUTURES_CATALOG. All identifiers
 * end with "=F" to disambiguate from spot tickers (SI=F the silver future
 * vs SI the equity ticker for Silvergate Capital, etc.).
 */

import type { TrackedEntityInput } from '../types'

interface FutureSpec {
  symbol: string // root symbol without =F suffix (e.g., "CL")
  name: string
  subcategory: 'energy' | 'metals' | 'grains' | 'softs' | 'livestock' | 'equity_index' | 'treasury' | 'fx' | 'crypto'
  aliases: string[]
  exchange: 'CME' | 'ICE' | 'CBOT' | 'NYMEX' | 'COMEX'
  category: 'commodity' | 'fx' | 'equity' | 'crypto'
}

const COMMODITY_TRIGGERS = Object.freeze(['T-GT4', 'T-GT5', 'T-GT6', 'T-GT7', 'T-GT8'])
const FX_TRIGGERS = Object.freeze(['T-GT5', 'T-GT6', 'T-GT9'])
const INDEX_TRIGGERS = Object.freeze(['T-GT5', 'T-GT6', 'T-GT9'])
const TREASURY_TRIGGERS = Object.freeze(['T-GT5', 'T-GT6', 'T-GT9'])
const CRYPTO_FUTURES_TRIGGERS = Object.freeze(['T-GT4', 'T-GT5', 'T-GT6'])

export const FUTURES_CATALOG: readonly FutureSpec[] = Object.freeze([
  // ── Energy ──
  { symbol: 'CL',  name: 'WTI Crude Oil',           subcategory: 'energy', exchange: 'NYMEX', category: 'commodity', aliases: ['WTI', 'Crude'] },
  { symbol: 'BZ',  name: 'Brent Crude Oil',         subcategory: 'energy', exchange: 'ICE',   category: 'commodity', aliases: ['Brent'] },
  { symbol: 'NG',  name: 'Henry Hub Natural Gas',   subcategory: 'energy', exchange: 'NYMEX', category: 'commodity', aliases: ['Natural Gas', 'Nat Gas'] },
  { symbol: 'HO',  name: 'Heating Oil',             subcategory: 'energy', exchange: 'NYMEX', category: 'commodity', aliases: ['Heating Oil'] },
  { symbol: 'RB',  name: 'RBOB Gasoline',           subcategory: 'energy', exchange: 'NYMEX', category: 'commodity', aliases: ['Gasoline', 'RBOB'] },
  // ── Metals ──
  { symbol: 'GC',  name: 'Gold',                    subcategory: 'metals', exchange: 'COMEX', category: 'commodity', aliases: ['Gold'] },
  { symbol: 'SI',  name: 'Silver',                  subcategory: 'metals', exchange: 'COMEX', category: 'commodity', aliases: ['Silver'] },
  { symbol: 'HG',  name: 'Copper',                  subcategory: 'metals', exchange: 'COMEX', category: 'commodity', aliases: ['Copper'] },
  { symbol: 'PL',  name: 'Platinum',                subcategory: 'metals', exchange: 'NYMEX', category: 'commodity', aliases: ['Platinum'] },
  { symbol: 'PA',  name: 'Palladium',               subcategory: 'metals', exchange: 'NYMEX', category: 'commodity', aliases: ['Palladium'] },
  // ── Grains ──
  { symbol: 'ZW',  name: 'Wheat',                   subcategory: 'grains', exchange: 'CBOT', category: 'commodity', aliases: ['Wheat'] },
  { symbol: 'ZC',  name: 'Corn',                    subcategory: 'grains', exchange: 'CBOT', category: 'commodity', aliases: ['Corn'] },
  { symbol: 'ZS',  name: 'Soybeans',                subcategory: 'grains', exchange: 'CBOT', category: 'commodity', aliases: ['Soybeans', 'Soy'] },
  { symbol: 'ZL',  name: 'Soybean Oil',             subcategory: 'grains', exchange: 'CBOT', category: 'commodity', aliases: ['Soy Oil', 'Soybean Oil'] },
  { symbol: 'ZM',  name: 'Soybean Meal',            subcategory: 'grains', exchange: 'CBOT', category: 'commodity', aliases: ['Soy Meal', 'Soybean Meal'] },
  { symbol: 'ZO',  name: 'Oats',                    subcategory: 'grains', exchange: 'CBOT', category: 'commodity', aliases: ['Oats'] },
  // ── Softs ──
  { symbol: 'CC',  name: 'Cocoa',                   subcategory: 'softs',  exchange: 'ICE',   category: 'commodity', aliases: ['Cocoa'] },
  { symbol: 'KC',  name: 'Coffee',                  subcategory: 'softs',  exchange: 'ICE',   category: 'commodity', aliases: ['Coffee'] },
  { symbol: 'CT',  name: 'Cotton',                  subcategory: 'softs',  exchange: 'ICE',   category: 'commodity', aliases: ['Cotton'] },
  { symbol: 'SB',  name: 'Sugar',                   subcategory: 'softs',  exchange: 'ICE',   category: 'commodity', aliases: ['Sugar'] },
  { symbol: 'OJ',  name: 'Orange Juice',            subcategory: 'softs',  exchange: 'ICE',   category: 'commodity', aliases: ['OJ', 'Orange Juice'] },
  // ── Livestock ──
  { symbol: 'LE',  name: 'Live Cattle',             subcategory: 'livestock', exchange: 'CME', category: 'commodity', aliases: ['Live Cattle', 'Cattle'] },
  { symbol: 'GF',  name: 'Feeder Cattle',           subcategory: 'livestock', exchange: 'CME', category: 'commodity', aliases: ['Feeder Cattle'] },
  { symbol: 'HE',  name: 'Lean Hogs',               subcategory: 'livestock', exchange: 'CME', category: 'commodity', aliases: ['Lean Hogs', 'Hogs'] },
  // ── Equity Index ──
  { symbol: 'ES',  name: 'S&P 500 E-mini',          subcategory: 'equity_index', exchange: 'CME', category: 'equity', aliases: ['S&P 500 Future', 'ES'] },
  { symbol: 'NQ',  name: 'Nasdaq-100 E-mini',       subcategory: 'equity_index', exchange: 'CME', category: 'equity', aliases: ['Nasdaq Future', 'NQ'] },
  { symbol: 'YM',  name: 'Dow Jones E-mini',        subcategory: 'equity_index', exchange: 'CBOT', category: 'equity', aliases: ['Dow Future', 'YM'] },
  { symbol: 'RTY', name: 'Russell 2000 E-mini',     subcategory: 'equity_index', exchange: 'CME', category: 'equity', aliases: ['Russell Future', 'RTY'] },
  // ── Treasury ──
  { symbol: 'ZB',  name: '30-Year Treasury Bond',   subcategory: 'treasury', exchange: 'CBOT', category: 'fx', aliases: ['30Y Treasury', 'Long Bond'] },
  { symbol: 'ZN',  name: '10-Year Treasury Note',   subcategory: 'treasury', exchange: 'CBOT', category: 'fx', aliases: ['10Y Treasury'] },
  { symbol: 'ZT',  name: '2-Year Treasury Note',    subcategory: 'treasury', exchange: 'CBOT', category: 'fx', aliases: ['2Y Treasury'] },
  { symbol: 'ZF',  name: '5-Year Treasury Note',    subcategory: 'treasury', exchange: 'CBOT', category: 'fx', aliases: ['5Y Treasury'] },
  // ── FX ──
  { symbol: '6E',  name: 'Euro FX Future',          subcategory: 'fx', exchange: 'CME', category: 'fx', aliases: ['EUR', 'EUR/USD Future'] },
  { symbol: '6J',  name: 'Japanese Yen Future',     subcategory: 'fx', exchange: 'CME', category: 'fx', aliases: ['JPY', 'Yen Future'] },
  { symbol: '6B',  name: 'British Pound Future',    subcategory: 'fx', exchange: 'CME', category: 'fx', aliases: ['GBP', 'Pound Future'] },
  { symbol: '6A',  name: 'Australian Dollar Future',subcategory: 'fx', exchange: 'CME', category: 'fx', aliases: ['AUD'] },
  { symbol: '6C',  name: 'Canadian Dollar Future',  subcategory: 'fx', exchange: 'CME', category: 'fx', aliases: ['CAD'] },
  { symbol: '6S',  name: 'Swiss Franc Future',      subcategory: 'fx', exchange: 'CME', category: 'fx', aliases: ['CHF', 'Franc Future'] },
  // ── Crypto futures on CME (user's Phase 1b addition) ──
  { symbol: 'MBT', name: 'Micro Bitcoin Future',    subcategory: 'crypto', exchange: 'CME', category: 'crypto', aliases: ['MBT', 'Bitcoin Future', 'BTC Future'] },
  { symbol: 'MET', name: 'Micro Ether Future',      subcategory: 'crypto', exchange: 'CME', category: 'crypto', aliases: ['MET', 'Ether Future', 'ETH Future'] },
])

export function loadFuturesEntities(): TrackedEntityInput[] {
  return FUTURES_CATALOG.map((spec) => {
    let triggers: readonly string[]
    switch (spec.category) {
      case 'commodity': triggers = COMMODITY_TRIGGERS; break
      case 'fx':        triggers = spec.subcategory === 'treasury' ? TREASURY_TRIGGERS : FX_TRIGGERS; break
      case 'equity':    triggers = INDEX_TRIGGERS; break
      case 'crypto':    triggers = CRYPTO_FUTURES_TRIGGERS; break
    }
    const identifier = `${spec.symbol}=F`
    return {
      identifier,
      name: spec.name,
      category: spec.category,
      subcategory: spec.subcategory,
      providerIds: {
        cmeSymbol: spec.exchange === 'CME' || spec.exchange === 'CBOT' || spec.exchange === 'NYMEX' || spec.exchange === 'COMEX' ? spec.symbol : undefined,
        iceSymbol: spec.exchange === 'ICE' ? spec.symbol : undefined,
        tickerSuffix: '=F',
      },
      groundTruthMap: { applicableTriggers: [...triggers] },
      entityStrings: {
        aliases: Array.from(new Set([identifier, spec.symbol, spec.name, ...spec.aliases])),
      },
    }
  })
}
