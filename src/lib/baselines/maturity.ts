/**
 * Per-metric baseline maturity thresholds — Phase 1 addendum A1.1.
 *
 * A baseline is "mature" when its sampleCount >= minSampleSize for that
 * specific metric. Triggers only fire on mature baselines; immature ones
 * show "calibrating — X days remaining" on the admin dashboard.
 *
 * The minimum sample sizes are set by the expected observation cadence of
 * the underlying signal stream. 71-75% coverage of the rolling window
 * accommodates normal ingestion hiccups without delaying maturity until
 * 100% of observations have landed.
 */

export const MATURITY_THRESHOLDS = {
  // ── Narrative stream ──
  article_volume_hourly: 120,         // 7 days × 24 hours × 71% coverage
  // cross_outlet_amplification is absolute — no baseline

  // ── Psychological stream ──
  cashtag_velocity_hourly: 240,       // 14 days × 24 hours × 71%
  engagement_acceleration_minute: 48, // 4 hours × 12 observations (5-min bins)

  // ── Ground-truth stream ──
  price_volatility_30d: 25,           // 25 trading days within a 30-day window
  price_gap_30d: 25,                  // same

  // ── Maritime (ZoneBaseline) ──
  tankerCount: 90,                    // 30 days × 4 obs/day × 75%
  containerShipCount: 90,
  bulkCarrierCount: 90,
  lngCarrierCount: 90,

  // ── Macro inventory / release surprise ──
  macro_surprise: 20,                 // 20 historical releases per A1.4 T-GT9
  inventory_surprise: 20,             // 20 historical releases per A1.4 T-GT8
} as const

export type MaturityMetric = keyof typeof MATURITY_THRESHOLDS

/**
 * Returns the minimum sample size for a given metric, or a conservative
 * default (100) when the metric isn't in the threshold table. The default
 * is deliberately high — unknown metrics should not fire triggers until
 * we've explicitly decided what "mature" means for them.
 */
export function minSampleSize(metricName: string): number {
  const typed = metricName as MaturityMetric
  return MATURITY_THRESHOLDS[typed] ?? 100
}

/** Convenience predicate used by baseline refreshers on write. */
export function isMature(metricName: string, sampleCount: number): boolean {
  return sampleCount >= minSampleSize(metricName)
}
