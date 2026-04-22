/**
 * Entity extraction from article / post text.
 *
 * Deterministic, regex + alias-index based. No LLM calls per text —
 * cost discipline. LLM layer runs downstream on flagged TriggerEvents
 * in Phase 2.
 *
 * Strategy (per match-precedence order):
 *   1. Cashtag match: $AAPL, $BTC — explicit disambiguation from poster.
 *      Pattern: /\$([A-Z]{1,6}(?:\.[A-Z])?)\b/g
 *   2. Ticker match: plain uppercase word-boundary, looked up in
 *      index.byIdentifier. Skip common-English false positives (T for
 *      AT&T would match every sentence starting with "The").
 *   3. Alias match: case-insensitive substring match against the sorted
 *      alias list, with word-boundary guards.
 *
 * Output is deduplicated by entityId — multiple matches for the same
 * entity (e.g., $AAPL and "Apple Inc" in the same article) collapse to
 * one entry, preferring the earliest match in the precedence order.
 */

import type { AliasEntry, AliasIndex } from './alias-index'

export type MatchType = 'cashtag' | 'ticker' | 'alias'

export interface ExtractedMatch {
  entityId: string
  identifier: string
  matchedText: string
  matchType: MatchType
}

/**
 * Common English words that collide with valid 1-3 char tickers. These
 * are rejected from ticker matching to avoid firing on "T" in "The", "I"
 * in "I think", etc. Cashtag form ($T) bypasses this — the $ is the
 * disambiguation.
 */
const ENGLISH_FALSE_POSITIVES = new Set<string>([
  'A', 'I', 'T', 'IT', 'IS', 'AT', 'BE', 'BY', 'IF', 'IN', 'NO', 'ON',
  'OR', 'SO', 'TO', 'UP', 'US', 'WE',
  'ALL', 'AND', 'ARE', 'BUT', 'CAN', 'FOR', 'HAD', 'HAS', 'HER', 'HIM',
  'HIS', 'HOW', 'NOT', 'NOW', 'OUR', 'OUT', 'SEE', 'SHE', 'THE', 'TOO',
  'WAS', 'WHO', 'WHY', 'YOU', 'NEW', 'ONE',
])

const CASHTAG_RE = /\$([A-Z]{1,6}(?:\.[A-Z])?)\b/g
const TICKER_RE = /\b([A-Z]{2,5}(?:\.[A-Z])?)\b/g

export function extractEntities(
  text: string,
  index: AliasIndex,
): ExtractedMatch[] {
  if (!text) return []

  const seen = new Map<string, ExtractedMatch>()

  // 1. Cashtag pass
  let m: RegExpExecArray | null
  CASHTAG_RE.lastIndex = 0
  while ((m = CASHTAG_RE.exec(text)) !== null) {
    const symbol = m[1]
    const entry = index.byIdentifier.get(symbol)
    if (!entry) continue
    if (!seen.has(entry.entityId)) {
      seen.set(entry.entityId, asMatch(entry, m[0], 'cashtag'))
    }
  }

  // 2. Ticker pass (skip if already matched via cashtag)
  TICKER_RE.lastIndex = 0
  while ((m = TICKER_RE.exec(text)) !== null) {
    const symbol = m[1]
    if (ENGLISH_FALSE_POSITIVES.has(symbol)) continue
    const entry = index.byIdentifier.get(symbol)
    if (!entry) continue
    if (!seen.has(entry.entityId)) {
      seen.set(entry.entityId, asMatch(entry, m[0], 'ticker'))
    }
  }

  // 3. Alias pass (longest first, case-insensitive word-boundary match)
  const lower = text.toLowerCase()
  for (const alias of index.sortedAliases) {
    // Micro-opt: skip aliases already in the identifier map (we'd double-
    // count ticker form).
    if (alias.length < 3) continue
    const entry = index.byAlias.get(alias)
    if (!entry) continue
    if (seen.has(entry.entityId)) continue
    if (hasWordBoundaryMatch(lower, alias)) {
      seen.set(entry.entityId, asMatch(entry, alias, 'alias'))
    }
  }

  return Array.from(seen.values())
}

function asMatch(entry: AliasEntry, matchedText: string, matchType: MatchType): ExtractedMatch {
  return {
    entityId: entry.entityId,
    identifier: entry.identifier,
    matchedText,
    matchType,
  }
}

/**
 * Substring match with word-boundary guards on both sides. Rejects
 * "Apple" matching inside "Appleton" etc.
 */
function hasWordBoundaryMatch(lowerText: string, lowerNeedle: string): boolean {
  let startSearch = 0
  while (startSearch < lowerText.length) {
    const idx = lowerText.indexOf(lowerNeedle, startSearch)
    if (idx === -1) return false
    const before = idx === 0 ? ' ' : lowerText[idx - 1]
    const after = idx + lowerNeedle.length >= lowerText.length
      ? ' '
      : lowerText[idx + lowerNeedle.length]
    if (isBoundary(before) && isBoundary(after)) return true
    startSearch = idx + 1
  }
  return false
}

function isBoundary(ch: string): boolean {
  return !/[a-z0-9]/i.test(ch)
}
