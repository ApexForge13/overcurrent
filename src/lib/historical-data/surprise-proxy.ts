/**
 * Release-to-release surprise-stddev PROXY.
 *
 * Real `surprise = actual − consensus` requires historical consensus data
 * that isn't available for free over 5 years. Phase 1b populates
 * MacroIndicatorConfig.historicalStddev with the stddev of
 * `(current_release − previous_release) / previous_release` — i.e., the
 * observed volatility of the release series itself. Phase 1c consensus
 * scraping replaces this proxy with real surprise-vs-consensus stddev
 * as ≥20 surprises accumulate.
 *
 * This is documented with `historicalStddevProxy: true` on the config row
 * and surfaced in the admin dashboard so operators know the number is
 * approximate.
 *
 * Edge cases handled:
 *   - Zero or single observation: returns { stddev: 1.0, deltaCount: 0 }
 *     — a neutral default that neither fires nor suppresses triggers
 *     unreasonably. The proxy flag stays true so the UI can show a
 *     "insufficient_history" hint.
 *   - Consecutive observations where the prior value is zero: the delta
 *     would be infinite. These observations are skipped (shouldn't happen
 *     for macro indicators in practice, but the guard is cheap).
 */

import { computeStats } from '@/lib/baselines/stats'

export interface SurpriseProxyResult {
  stddev: number
  deltaCount: number
  /** Used deltas, kept for test introspection. */
  deltas: number[]
}

export interface ReleaseObservation {
  date: string // ISO — sort key
  value: number
}

/**
 * Compute the release-to-release stddev proxy for a sorted or unsorted
 * observation series. Sorts internally by `date` ascending.
 */
export function computeSurpriseProxy(
  observations: readonly ReleaseObservation[],
): SurpriseProxyResult {
  if (observations.length < 2) {
    return { stddev: 1.0, deltaCount: 0, deltas: [] }
  }
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date))
  const deltas: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value
    const curr = sorted[i].value
    if (prev === 0) continue
    deltas.push((curr - prev) / prev)
  }
  if (deltas.length === 0) {
    return { stddev: 1.0, deltaCount: 0, deltas }
  }
  const stats = computeStats(deltas)
  // Guard against zero-stddev (all deltas identical) — still return a
  // small positive so downstream z-score computation doesn't divide by 0.
  const stddev = stats.stddev > 0 ? stats.stddev : 1.0
  return { stddev, deltaCount: deltas.length, deltas }
}
