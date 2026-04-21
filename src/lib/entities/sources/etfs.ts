/**
 * ETF catalog — hardcoded list of major ETFs.
 *
 * Most of these also appear in the SEC company_tickers feed (ETFs are
 * registered investment companies). The orchestrator dedupes by
 * TrackedEntity.identifier — if both sources emit SPY, the later upsert
 * wins with category='etf' metadata. SEC's 'equity' default for ETFs is
 * corrected by this loader.
 *
 * Scope covers:
 *   - Broad market: SPY, QQQ, IWM, DIA, VTI, VOO, VXUS
 *   - Bonds: TLT, IEF, SHY, LQD, HYG
 *   - Commodities (physical-backed): GLD, SLV, USO, UNG, CPER, DBA
 *   - Sector SPDRs: XLE, XLF, XLK, XLV, XLI, XLU, XLY, XLP, XLB, XRE, XLC
 *   - International: EEM, EFA, FXI, EWJ, EWZ, EWG, INDA
 *   - Thematic: ARKK, SOXX, SMH, IBIT (spot Bitcoin), GBTC
 *   - Volatility: VXX, UVXY
 *
 * Updates: append to ETF_CATALOG. Identifier is just the ticker (no suffix).
 */

import type { TrackedEntityInput } from '../types'

interface EtfSpec {
  ticker: string
  name: string
  subcategory: 'broad_market' | 'bonds' | 'commodity_etf' | 'sector' | 'international' | 'thematic' | 'volatility'
  aliases?: string[]
}

const ETF_TRIGGERS = Object.freeze([
  'T-GT1', // Form 4 on ETF holders (rare but valid)
  'T-GT5', // intraday price move
  'T-GT6', // overnight price gap
  'T-GT9', // macro surprise — ETFs respond to macro releases
])

export const ETF_CATALOG: readonly EtfSpec[] = Object.freeze([
  // Broad market
  { ticker: 'SPY',  name: 'SPDR S&P 500 ETF Trust',                 subcategory: 'broad_market' },
  { ticker: 'QQQ',  name: 'Invesco QQQ Trust',                      subcategory: 'broad_market' },
  { ticker: 'IWM',  name: 'iShares Russell 2000 ETF',               subcategory: 'broad_market' },
  { ticker: 'DIA',  name: 'SPDR Dow Jones Industrial Average ETF',  subcategory: 'broad_market' },
  { ticker: 'VTI',  name: 'Vanguard Total Stock Market ETF',        subcategory: 'broad_market' },
  { ticker: 'VOO',  name: 'Vanguard S&P 500 ETF',                   subcategory: 'broad_market' },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', subcategory: 'broad_market' },

  // Bonds
  { ticker: 'TLT',  name: 'iShares 20+ Year Treasury Bond ETF',     subcategory: 'bonds' },
  { ticker: 'IEF',  name: 'iShares 7-10 Year Treasury Bond ETF',    subcategory: 'bonds' },
  { ticker: 'SHY',  name: 'iShares 1-3 Year Treasury Bond ETF',     subcategory: 'bonds' },
  { ticker: 'LQD',  name: 'iShares iBoxx Inv Grade Corporate Bond', subcategory: 'bonds' },
  { ticker: 'HYG',  name: 'iShares iBoxx High Yield Corporate Bond',subcategory: 'bonds' },

  // Commodity ETFs
  { ticker: 'GLD',  name: 'SPDR Gold Shares',                       subcategory: 'commodity_etf', aliases: ['Gold ETF'] },
  { ticker: 'SLV',  name: 'iShares Silver Trust',                   subcategory: 'commodity_etf', aliases: ['Silver ETF'] },
  { ticker: 'USO',  name: 'United States Oil Fund',                 subcategory: 'commodity_etf', aliases: ['Oil ETF'] },
  { ticker: 'BNO',  name: 'United States Brent Oil Fund',           subcategory: 'commodity_etf', aliases: ['Brent ETF'] },
  { ticker: 'UNG',  name: 'United States Natural Gas Fund',         subcategory: 'commodity_etf', aliases: ['Nat Gas ETF'] },
  { ticker: 'CPER', name: 'United States Copper Index Fund',        subcategory: 'commodity_etf', aliases: ['Copper ETF'] },
  { ticker: 'DBA',  name: 'Invesco DB Agriculture Fund',            subcategory: 'commodity_etf' },
  { ticker: 'WEAT', name: 'Teucrium Wheat Fund',                    subcategory: 'commodity_etf' },
  { ticker: 'CORN', name: 'Teucrium Corn Fund',                     subcategory: 'commodity_etf' },
  { ticker: 'SOYB', name: 'Teucrium Soybean Fund',                  subcategory: 'commodity_etf' },

  // Sector SPDRs
  { ticker: 'XLE',  name: 'Energy Select Sector SPDR',              subcategory: 'sector' },
  { ticker: 'XLF',  name: 'Financial Select Sector SPDR',           subcategory: 'sector' },
  { ticker: 'XLK',  name: 'Technology Select Sector SPDR',          subcategory: 'sector' },
  { ticker: 'XLV',  name: 'Health Care Select Sector SPDR',         subcategory: 'sector' },
  { ticker: 'XLI',  name: 'Industrial Select Sector SPDR',          subcategory: 'sector' },
  { ticker: 'XLU',  name: 'Utilities Select Sector SPDR',           subcategory: 'sector' },
  { ticker: 'XLY',  name: 'Consumer Discretionary Select Sector',   subcategory: 'sector' },
  { ticker: 'XLP',  name: 'Consumer Staples Select Sector SPDR',    subcategory: 'sector' },
  { ticker: 'XLB',  name: 'Materials Select Sector SPDR',           subcategory: 'sector' },
  { ticker: 'XLRE', name: 'Real Estate Select Sector SPDR',         subcategory: 'sector' },
  { ticker: 'XLC',  name: 'Communication Services Select Sector',   subcategory: 'sector' },

  // International
  { ticker: 'EEM',  name: 'iShares MSCI Emerging Markets ETF',      subcategory: 'international' },
  { ticker: 'EFA',  name: 'iShares MSCI EAFE ETF',                  subcategory: 'international' },
  { ticker: 'FXI',  name: 'iShares China Large-Cap ETF',            subcategory: 'international' },
  { ticker: 'EWJ',  name: 'iShares MSCI Japan ETF',                 subcategory: 'international' },
  { ticker: 'EWZ',  name: 'iShares MSCI Brazil ETF',                subcategory: 'international' },
  { ticker: 'EWG',  name: 'iShares MSCI Germany ETF',               subcategory: 'international' },
  { ticker: 'INDA', name: 'iShares MSCI India ETF',                 subcategory: 'international' },
  { ticker: 'MCHI', name: 'iShares MSCI China ETF',                 subcategory: 'international' },

  // Thematic
  { ticker: 'ARKK', name: 'ARK Innovation ETF',                     subcategory: 'thematic' },
  { ticker: 'SOXX', name: 'iShares Semiconductor ETF',              subcategory: 'thematic' },
  { ticker: 'SMH',  name: 'VanEck Semiconductor ETF',               subcategory: 'thematic' },
  { ticker: 'IBIT', name: 'iShares Bitcoin Trust',                  subcategory: 'thematic', aliases: ['Spot Bitcoin ETF'] },
  { ticker: 'GBTC', name: 'Grayscale Bitcoin Trust',                subcategory: 'thematic' },
  { ticker: 'ETHE', name: 'Grayscale Ethereum Trust',               subcategory: 'thematic' },

  // Volatility
  { ticker: 'VXX',  name: 'iPath Series B S&P 500 VIX Short-Term',  subcategory: 'volatility' },
  { ticker: 'UVXY', name: 'ProShares Ultra VIX Short-Term Futures', subcategory: 'volatility' },
])

export function loadEtfEntities(): TrackedEntityInput[] {
  return ETF_CATALOG.map((spec) => ({
    identifier: spec.ticker,
    name: spec.name,
    category: 'etf' as const,
    subcategory: spec.subcategory,
    providerIds: {
      tickerSuffix: '',
    },
    groundTruthMap: { applicableTriggers: [...ETF_TRIGGERS] },
    entityStrings: {
      aliases: Array.from(
        new Set([spec.ticker, spec.name, `$${spec.ticker}`, ...(spec.aliases ?? [])]),
      ),
    },
  }))
}
