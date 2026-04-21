/**
 * Rolling statistics primitives — pure functions, no I/O.
 *
 * Used by EntityBaseline and ZoneBaseline refreshers. Centralized here so
 * every baseline refresher computes stats identically (same stddev
 * convention, same empty-input handling).
 *
 * stddev uses the population formula (dividing by N, not N-1). This is
 * appropriate when the observations ARE the population of interest for
 * the rolling window — we're not estimating a parameter from a sample,
 * we're describing the observed distribution over the window.
 */

export interface Stats {
  mean: number
  stddev: number
  count: number
}

/**
 * Compute rolling statistics for a set of numeric observations.
 *
 * Empty input → `{ mean: 0, stddev: 0, count: 0 }`. Callers check
 * `count >= minSampleSize` via `isMature()` before using the stats.
 * Single-observation input → `{ mean: obs, stddev: 0, count: 1 }`.
 */
export function computeStats(observations: readonly number[]): Stats {
  const count = observations.length
  if (count === 0) return { mean: 0, stddev: 0, count: 0 }

  let sum = 0
  for (const x of observations) sum += x
  const mean = sum / count

  if (count === 1) return { mean, stddev: 0, count: 1 }

  let sumSqDiff = 0
  for (const x of observations) {
    const d = x - mean
    sumSqDiff += d * d
  }
  const variance = sumSqDiff / count
  const stddev = Math.sqrt(variance)
  return { mean, stddev, count }
}

/**
 * Compute the z-score of a single observation against precomputed stats.
 * Returns 0 when stddev is 0 (avoids division by zero — no dispersion means
 * the observation is either exactly the mean or the stats are degenerate).
 */
export function zScore(observation: number, stats: Stats): number {
  if (stats.stddev === 0) return 0
  return (observation - stats.mean) / stats.stddev
}
