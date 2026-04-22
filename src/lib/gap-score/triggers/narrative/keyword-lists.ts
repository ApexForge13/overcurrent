/**
 * Directional keyword lists for T-N4 (entity sentiment extremity batch) and
 * T-P4 (psychological sentiment consensus).
 *
 * Per the Phase 1 trigger addendum A1.2 (T-N4). Admin UI Phase 1c.2b.2
 * will move these to a DB-backed editable list; for now they're code.
 *
 * Keywords are lowercased for case-insensitive matching. Phrases include
 * multi-word tokens (e.g., "record high"); the matcher uses substring
 * matching so phrase-form works transparently.
 */

export const BULLISH_KEYWORDS: readonly string[] = Object.freeze([
  'surges', 'skyrockets', 'jumps', 'breakthrough', 'approved', 'beats',
  'upgrades', 'outperforms', 'record high', 'rally', 'soars', 'boosts',
  'raises outlook', 'raised guidance', 'crushes estimates', 'beat expectations',
  'strong earnings', 'blowout', 'surprise profit', 'expansion',
])

export const BEARISH_KEYWORDS: readonly string[] = Object.freeze([
  'plunges', 'crashes', 'tumbles', 'drops', 'rejected', 'misses',
  'downgrades', 'underperforms', 'record low', 'sinks', 'cuts outlook',
  'cut guidance', 'investigation', 'lawsuit', 'probe', 'recall',
  'fraud', 'bankruptcy', 'layoffs', 'restructuring', 'loss widens',
  'going concern',
])

export type Direction = 1 | -1

/**
 * Classify a single text as bullish, bearish, or neutral. Uses
 * case-insensitive substring matching. Returns { direction, matches }
 * where matches is the list of keywords that fired.
 *
 * Direction is determined by which set has more matches; ties produce
 * null (ambiguous).
 */
export function classifyDirection(text: string): {
  direction: Direction | null
  bullishMatches: string[]
  bearishMatches: string[]
} {
  const lower = text.toLowerCase()
  const bullishMatches = BULLISH_KEYWORDS.filter((k) => lower.includes(k))
  const bearishMatches = BEARISH_KEYWORDS.filter((k) => lower.includes(k))
  let direction: Direction | null = null
  if (bullishMatches.length > bearishMatches.length) direction = 1
  else if (bearishMatches.length > bullishMatches.length) direction = -1
  // Ties leave direction=null (ambiguous)
  return { direction, bullishMatches, bearishMatches }
}
