/**
 * Arc-phase recommendation logic — shared between server and client.
 *
 * Used by:
 *   - /api/admin/umbrellas/[id]/arcs  (recommended phase for each arc dropdown entry)
 *   - Admin analysis-initiation form   (inline preview after arc selection)
 *   - Step 3's arc-queue page         (queue ordering + next-phase display)
 *
 * Thresholds match the spec exactly:
 *   <12h    → first_wave
 *   12-48h  → development
 *   48h-7d  → consolidation
 *   >7d     → tail
 */

export type StoryPhase = 'first_wave' | 'development' | 'consolidation' | 'tail'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export function recommendedPhaseFromElapsedHours(hours: number): StoryPhase {
  if (hours < 12) return 'first_wave'
  if (hours < 48) return 'development'
  if (hours < 168) return 'consolidation' // 7 days
  return 'tail'
}

export function recommendedPhaseFromFirstDetectedAt(
  firstDetectedAt: Date | string | null | undefined,
  referenceDate: Date = new Date(),
): StoryPhase {
  if (!firstDetectedAt) return 'first_wave'
  const ms = referenceDate.getTime() - new Date(firstDetectedAt).getTime()
  return recommendedPhaseFromElapsedHours(ms / HOUR)
}

/**
 * Next-scheduled-date logic (for ArcPhaseSchedule in Step 3).
 * If current phase was First Wave   → re-analysis in 36 hours
 * If current phase was Development  → re-analysis in 7 days
 * If current phase was Consolidation → re-analysis in 21 days
 * If current phase was Tail         → manual extend (returns null)
 */
export function nextScheduledDateFromPhase(
  completedPhase: StoryPhase,
  completedAt: Date = new Date(),
): Date | null {
  const ms = completedAt.getTime()
  switch (completedPhase) {
    case 'first_wave':
      return new Date(ms + 36 * HOUR)
    case 'development':
      return new Date(ms + 7 * DAY)
    case 'consolidation':
      return new Date(ms + 21 * DAY)
    case 'tail':
      return null
  }
}
