/**
 * Featured set — the 15 assets always scanned at baseline 3h cadence,
 * regardless of triggers (v2 Part 2.1 + Phase 1 addendum A1.7 T-META2).
 *
 * Composition (matches the spec's 6 commodity + 7 equity + 2 crypto = 15):
 *   - 6 commodities:  WTI, Brent, NG, Gold, Copper, Soybeans
 *   - 7 equities:     AAPL, NVDA, TSLA, XOM, JPM, SPY, QQQ
 *   - 2 crypto:       BTC, ETH
 *
 * Identifiers here MUST match `TrackedEntity.identifier` values produced by
 * the respective source loaders. On seed, `scripts/seed-featured-set.ts`
 * flips `isFeatured: true` for these rows (idempotent upsert).
 */

export const FEATURED_SET_IDENTIFIERS: readonly string[] = Object.freeze([
  // ── Commodities (6) ──
  'CL=F', // WTI crude
  'BZ=F', // Brent crude
  'NG=F', // Henry Hub natural gas
  'GC=F', // Gold
  'HG=F', // Copper
  'ZS=F', // Soybeans

  // ── Equities (7) ──
  'AAPL',
  'NVDA',
  'TSLA',
  'XOM',
  'JPM',
  'SPY',
  'QQQ',

  // ── Crypto (2) ──
  'BTC',
  'ETH',
])

export const FEATURED_SET_BREAKDOWN = Object.freeze({
  commodity: 6,
  equity: 7,
  crypto: 2,
  total: 15,
})

export function isFeatured(identifier: string): boolean {
  return FEATURED_SET_IDENTIFIERS.includes(identifier)
}
