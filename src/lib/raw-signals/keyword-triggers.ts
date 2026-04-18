/**
 * Keyword triggers for Layer 3 logic.
 *
 * Scans the full analysis text (headline + synopsis + claims + framings)
 * for terms defined in KEYWORD_TRIGGERS. Case-insensitive, whole-word
 * where punctuation allows. Returns [signalType, matchedKeyword] pairs.
 */

import { KEYWORD_TRIGGERS } from './types'
import type { SignalType } from './types'

export interface KeywordMatchResult {
  signalType: SignalType
  matchedKeyword: string
  reason: string
}

// Build one large regex per signalType for efficient scanning.
const COMPILED_PATTERNS = KEYWORD_TRIGGERS.map(({ signalType, keywords }) => ({
  signalType,
  pattern: new RegExp(
    '\\b(' + keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
    'i',
  ),
  keywords,
}))

/**
 * Scan analysis text for keyword triggers.
 * Returns unique signalType matches with the keyword that triggered each.
 * First match wins — we don't return all matches, just the trigger reason.
 */
export function scanKeywords(text: string): KeywordMatchResult[] {
  const results: KeywordMatchResult[] = []
  const seen = new Set<SignalType>()

  for (const { signalType, pattern } of COMPILED_PATTERNS) {
    if (seen.has(signalType)) continue
    const match = pattern.exec(text)
    if (match) {
      results.push({
        signalType,
        matchedKeyword: match[1],
        reason: `analysis text contains "${match[1]}"`,
      })
      seen.add(signalType)
    }
  }

  return results
}
