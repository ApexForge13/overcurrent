/**
 * Story phase classification.
 *
 * Each analysis is tagged with the phase AT TIME OF RUN (frozen).
 * StoryCluster.currentPhase reflects the cluster's CURRENT phase (updates over time).
 *
 * MIN_SIGNAL: works after 1 analysis. No threshold required.
 *
 * Phase boundaries (from spec — global fixed):
 *   first_wave:     0 – 12h from cluster's firstDetectedAt
 *   development:    12 – 48h
 *   consolidation:  48h – 7d (168h)
 *   tail:           7d+
 */

export type StoryPhase = 'first_wave' | 'development' | 'consolidation' | 'tail'

const HOURS_FIRST_WAVE = 12
const HOURS_DEVELOPMENT = 48
const HOURS_CONSOLIDATION = 168 // 7 days

/**
 * Compute phase from hours-since-first-detection.
 * Used both for new analyses (freezing their storyPhase) and for updating
 * StoryCluster.currentPhase on each pipeline completion.
 */
export function phaseFromHours(hoursSinceFirstDetection: number): StoryPhase {
  if (hoursSinceFirstDetection < HOURS_FIRST_WAVE) return 'first_wave'
  if (hoursSinceFirstDetection < HOURS_DEVELOPMENT) return 'development'
  if (hoursSinceFirstDetection < HOURS_CONSOLIDATION) return 'consolidation'
  return 'tail'
}

/**
 * Compute phase from two timestamps.
 * Returns `tail` if either timestamp is missing or invalid.
 */
export function phaseFromDates(firstDetectedAt: Date | string | null | undefined, analyzedAt: Date | string = new Date()): StoryPhase {
  if (!firstDetectedAt) return 'first_wave' // no history = brand new story
  const first = firstDetectedAt instanceof Date ? firstDetectedAt : new Date(firstDetectedAt)
  const now = analyzedAt instanceof Date ? analyzedAt : new Date(analyzedAt)
  if (isNaN(first.getTime()) || isNaN(now.getTime())) return 'first_wave'
  const hours = (now.getTime() - first.getTime()) / (1000 * 60 * 60)
  return phaseFromHours(hours)
}
