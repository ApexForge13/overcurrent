/**
 * Wire-quality headline patterns for T-N3 (wire headline event).
 *
 * Each entry: id, pattern (RegExp, case-insensitive), category, direction.
 * Direction is +1 / -1 / 0 (ambiguous — defer to LLM sentiment scoring
 * in Phase 2).
 *
 * Per the Phase 1 trigger addendum A1.2 T-N3.
 */

export type WirePatternCategory =
  | 'earnings'
  | 'guidance'
  | 'm_and_a'
  | 'regulatory'
  | 'exec_change'
  | 'bankruptcy'
  | 'material_contract'

export interface WirePattern {
  id: string
  pattern: RegExp
  category: WirePatternCategory
  direction: 1 | -1 | 0
}

export const WIRE_PATTERNS: readonly WirePattern[] = Object.freeze([
  // Earnings surprise
  { id: 'earnings_beat', pattern: /\bbeat(?:s)?\b.*\b(consensus|expectations|estimates)\b/i, category: 'earnings', direction: 1 },
  { id: 'earnings_miss', pattern: /\bmiss(?:ed|es)?\b.*\b(consensus|expectations|estimates)\b/i, category: 'earnings', direction: -1 },
  { id: 'earnings_surprise', pattern: /\b(surprise (profit|loss))\b/i, category: 'earnings', direction: 0 },

  // Guidance revision
  { id: 'guidance_raise', pattern: /\b(raises?|hikes?|boosts?)\s+(?:full-?year\s+)?guidance\b/i, category: 'guidance', direction: 1 },
  { id: 'guidance_cut', pattern: /\b(cuts?|lowers?|reduces?|slashes?)\s+(?:full-?year\s+)?guidance\b/i, category: 'guidance', direction: -1 },

  // M&A
  { id: 'merger', pattern: /\b(merger|combines? with)\b/i, category: 'm_and_a', direction: 0 },
  { id: 'acquisition', pattern: /\b(acquires?|to acquire|buyout|takeover)\b/i, category: 'm_and_a', direction: 0 },

  // Regulatory
  { id: 'fda_approval', pattern: /\bFDA\s+(approval|approves?)\b/i, category: 'regulatory', direction: 1 },
  { id: 'regulatory_fine', pattern: /\b(fined?|penalt(y|ies)|settles? .*charges)\b/i, category: 'regulatory', direction: -1 },
  { id: 'regulatory_probe', pattern: /\b(SEC|DOJ|FTC|CFPB)\s+(investigat|prob|enforcement|charges)/i, category: 'regulatory', direction: -1 },

  // Exec change
  { id: 'exec_resign', pattern: /\b(CEO|CFO|COO|CTO|Chairman)\s+(resigns?|stepping down|exits?|departs?)\b/i, category: 'exec_change', direction: 0 },
  { id: 'exec_new', pattern: /\b(names?|appoints?)\s+new\s+(CEO|CFO|COO|CTO|Chairman)\b/i, category: 'exec_change', direction: 0 },

  // Bankruptcy
  { id: 'chapter_11', pattern: /\bChapter\s+11\b/i, category: 'bankruptcy', direction: -1 },
  { id: 'bankruptcy_file', pattern: /\b(files?|filing)\s+for\s+bankruptcy\b/i, category: 'bankruptcy', direction: -1 },

  // Material contract
  { id: 'contract_awarded', pattern: /\b(wins?|awarded|secures?)\s+(?:a\s+)?(?:major\s+)?contract\b/i, category: 'material_contract', direction: 1 },
  { id: 'contract_terminated', pattern: /\bcontract\s+(terminated?|cancelled?|revoked?)\b/i, category: 'material_contract', direction: -1 },
])

export interface WirePatternMatch {
  patternId: string
  category: WirePatternCategory
  direction: 1 | -1 | 0
  matchedText: string
}

/**
 * Run all wire patterns against the given text; return all matches.
 * Multiple patterns can fire on one headline (e.g., "beats consensus
 * AND raises guidance"). Caller decides how to collapse (e.g., max
 * severity, majority direction).
 */
export function matchWirePatterns(text: string): WirePatternMatch[] {
  if (!text) return []
  const matches: WirePatternMatch[] = []
  for (const wp of WIRE_PATTERNS) {
    const m = text.match(wp.pattern)
    if (m) {
      matches.push({
        patternId: wp.id,
        category: wp.category,
        direction: wp.direction,
        matchedText: m[0],
      })
    }
  }
  return matches
}
