/**
 * Macro indicator direction mappings — seed data for
 * MacroIndicatorConfig.directionMapping (Phase 1 addendum A1.5).
 *
 * Shape per indicator:
 *   { [assetIdentifier]: { positive: number, negative: number } }
 *
 * `positive` = direction (-1..+1) when (actual − consensus) > 0
 * `negative` = direction (-1..+1) when (actual − consensus) < 0
 *
 * Magnitudes between 0 and 1 express relative confidence in the link:
 *   1.0   = strong, well-established relationship (e.g., CPI → TLT)
 *   0.5   = diluted exposure (e.g., CPI → XOM — inflation affects oil
 *           majors but less directly than it affects bonds)
 *   0.25  = weak signal, included for completeness
 *
 * These mappings are STARTING POINTS per Phase 1 addendum — Phase 1c
 * monitoring and trader feedback will refine them as real surprises
 * accumulate. Update this file; re-run `seed-macro-config.ts` to push.
 *
 * Inverted indicators (Unemployment, Initial Claims) are intuitive once
 * you read: "positive surprise means MORE than consensus expected." For
 * Unemployment that's BAD for equities, so SPY.positive = -1.
 */

export interface AssetDirection {
  positive: number
  negative: number
}

export type IndicatorDirectionMap = Record<string, AssetDirection>

export const MACRO_DIRECTION_MAPS: Record<string, IndicatorDirectionMap> = Object.freeze({
  // ── Employment (beats generally bullish risk, except Unemployment/Claims which invert) ──
  PAYEMS: {
    SPY: { positive: 1,    negative: -1 },
    QQQ: { positive: 1,    negative: -1 },
    TLT: { positive: -1,   negative: 1 },
    'GC=F': { positive: -0.5, negative: 0.5 },
  },
  UNRATE: {
    // Inverted: higher-than-expected unemployment is bad
    SPY: { positive: -1, negative: 1 },
    QQQ: { positive: -1, negative: 1 },
    TLT: { positive: 1,  negative: -1 },
  },
  ICSA: {
    // Inverted: more claims than expected = bad
    SPY: { positive: -1, negative: 1 },
    TLT: { positive: 1,  negative: -1 },
  },
  CIVPART: {
    SPY: { positive: 0.5, negative: -0.5 },
  },
  CES0500000003: {
    // Hot wages = inflation pressure = bearish bonds, marginally bearish equities
    SPY: { positive: -0.5, negative: 0.5 },
    TLT: { positive: -1,   negative: 1 },
    'GC=F': { positive: 0.5, negative: -0.5 },
  },

  // ── Inflation (hot = bearish equities + bonds, bullish gold as hedge) ──
  CPIAUCSL: {
    SPY: { positive: -1,  negative: 1 },
    QQQ: { positive: -1,  negative: 1 },
    TLT: { positive: -1,  negative: 1 },
    'GC=F': { positive: 1, negative: -1 },
  },
  CPILFESL: {
    SPY: { positive: -1,  negative: 1 },
    QQQ: { positive: -1,  negative: 1 },
    TLT: { positive: -1,  negative: 1 },
    'GC=F': { positive: 1, negative: -1 },
  },
  PPIACO: {
    SPY: { positive: -0.5, negative: 0.5 },
    TLT: { positive: -1,   negative: 1 },
  },

  // ── Growth (beats bullish equities, marginally bearish bonds) ──
  RSAFS: {
    SPY: { positive: 1,  negative: -1 },
    QQQ: { positive: 1,  negative: -1 },
    TLT: { positive: -0.5, negative: 0.5 },
  },
  INDPRO: {
    SPY: { positive: 1,  negative: -1 },
    TLT: { positive: -0.5, negative: 0.5 },
  },
  GDPC1: {
    SPY: { positive: 1,   negative: -1 },
    QQQ: { positive: 1,   negative: -1 },
    TLT: { positive: -0.5, negative: 0.5 },
  },
  HOUST: {
    SPY: { positive: 0.5, negative: -0.5 },
  },
  IPMAN: {
    SPY: { positive: 1, negative: -1 },
  },

  // ── Monetary policy (hike surprise = restrictive = bearish) ──
  FEDFUNDS: {
    SPY: { positive: -1,   negative: 1 },
    QQQ: { positive: -1,   negative: 1 },
    TLT: { positive: -1,   negative: 1 },
    'GC=F': { positive: -0.5, negative: 0.5 },
  },

  // ── Sentiment ──
  UMCSENT: {
    SPY: { positive: 0.5, negative: -0.5 },
    QQQ: { positive: 0.5, negative: -0.5 },
  },

  // ── Commodity inventory releases (EIA/USDA) ──
  // Build = actual > consensus = bearish the commodity (oversupply)
  // Draw = actual < consensus = bullish the commodity (tight supply)
  EIA_CRUDE: {
    'CL=F': { positive: -1,   negative: 1 },
    'BZ=F': { positive: -1,   negative: 1 },
    XOM:    { positive: -0.5, negative: 0.5 },
    CVX:    { positive: -0.5, negative: 0.5 },
    USO:    { positive: -1,   negative: 1 },
    XLE:    { positive: -0.5, negative: 0.5 },
  },
  EIA_NATGAS: {
    'NG=F': { positive: -1, negative: 1 },
    UNG:    { positive: -1, negative: 1 },
  },
  USDA_WASDE_CORN: {
    'ZC=F': { positive: -1, negative: 1 },
    CORN:   { positive: -1, negative: 1 },
  },
  USDA_WASDE_SOY: {
    'ZS=F': { positive: -1, negative: 1 },
    SOYB:   { positive: -1, negative: 1 },
  },
  USDA_WASDE_WHEAT: {
    'ZW=F': { positive: -1, negative: 1 },
    WEAT:   { positive: -1, negative: 1 },
  },
})

export function getDirectionMap(indicator: string): IndicatorDirectionMap | null {
  return MACRO_DIRECTION_MAPS[indicator] ?? null
}
