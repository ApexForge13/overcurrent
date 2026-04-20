/**
 * Flag 3 (semantic_dedup) source uniqueness scorer.
 *
 * Single Haiku batch call that scores each source's claim uniqueness against
 * the rest of the source pool on a 0-10 integer scale:
 *   - 10 = source contains a claim, named source, or quantitative figure
 *          NOT covered by any other source in the pool. Keep in debate.
 *   - 0  = source is a near-duplicate of one or more other sources. Drop
 *          to haiku summary path.
 *
 * applyUniquenessToPaths in lib/semantic-dedup.ts uses these scores to demote
 * non-tier-1 sources scoring below the threshold (default 4).
 *
 * Conservative on every fallback path: missing scores, unknown URLs, JSON
 * parse failures, and Haiku call errors all default to score=10 (unique \u2192
 * keep in debate). Better to under-skip than over-skip.
 *
 * Cost target: under $0.02 per analysis (one Haiku call regardless of source
 * count). Larger input than Flag 2 since the prompt includes content snippets
 * from every source so Haiku can compare across the pool.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceForUniquenessScoring {
  url: string
  outlet: string
  title: string
  /** Best-effort article body \u2014 truncated server-side; may be empty. */
  content?: string
}

export interface UniquenessScore {
  url: string
  /** Integer 0-10. 10 = unique \u2192 keep in debate. 0 = duplicate \u2192 demote. */
  score: number
}

export interface ScorerResult {
  scores: UniquenessScore[]
  costUsd: number
}

/**
 * Caller signature for callClaude. Default is the real callClaude wrapper;
 * tests inject a stub to avoid API spend.
 */
export type ClaudeCaller = (options: {
  model: string
  systemPrompt: string
  userPrompt: string
  agentType: string
  maxTokens?: number
  region?: string
  storyId?: string
}) => Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }>

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a source-uniqueness scorer in the Overcurrent pipeline. You receive a pool of news sources covering the same story and rate each one on whether it adds NEW information vs the rest of the pool.

For each source, output an integer score 0-10:
  - 10 = source contains at least one specific claim, named source, quantitative figure, or angle that is NOT present in any other source in the pool. Keep this source in the full debate.
  - 7-9 = source contains a meaningfully different framing or context that adds value, even if the core facts overlap.
  - 4-6 = source duplicates the core facts but with minor framing differences.
  - 0-3 = source is a near-duplicate or wire-copy reprint of one or more other sources. Drop to haiku summary.

When uncertain, score HIGHER \u2014 the cost system prefers under-skipping debate to over-classifying as duplicate.

RESPOND WITH JSON ONLY. No markdown, no prose outside the JSON. Shape:
{
  "scores": [
    { "url": "<url>", "score": <integer 0-10> }
  ]
}

You MUST include one score per input source. Use the source URL exactly as provided.`

function buildUserPrompt(
  sources: ReadonlyArray<SourceForUniquenessScoring>,
  query: string,
): string {
  const sourceBlocks = sources
    .map((s, i) => {
      const body = (s.content ?? '').trim().slice(0, 600)
      return `[${i + 1}] ${s.outlet}\n  url: ${s.url}\n  title: ${s.title}\n  body: ${body || '(no body fetched)'}`
    })
    .join('\n\n')
  return `QUERY: ${query}

SOURCE POOL (${sources.length} sources):

${sourceBlocks}

Score each source for claim uniqueness vs the rest of the pool. Return the JSON.`
}

// ---------------------------------------------------------------------------
// Score normalization
// ---------------------------------------------------------------------------

/** Clamp to 0-10 integer. Non-numeric / out-of-range \u2192 default to 10 (conservative). */
function normalizeScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 10
  const rounded = Math.round(value)
  return Math.min(10, Math.max(0, rounded))
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Score a batch of sources for uniqueness against the rest of the pool.
 * Always returns one score per input source, in input order.
 * Conservative on every fallback path \u2014 missing/unknown/error \u2192 score 10.
 */
export async function scoreSourceUniqueness(
  sources: ReadonlyArray<SourceForUniquenessScoring>,
  query: string,
  opts: { storyId?: string; claudeCaller?: ClaudeCaller } = {},
): Promise<ScorerResult> {
  if (sources.length === 0) return { scores: [], costUsd: 0 }

  const caller = opts.claudeCaller ?? (callClaude as unknown as ClaudeCaller)
  const userPrompt = buildUserPrompt(sources, query)

  let result: { text: string; inputTokens: number; outputTokens: number; costUsd: number }
  try {
    result = await caller({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'semantic_dedup_scorer',
      maxTokens: 2048,
      storyId: opts.storyId,
    })
  } catch (err) {
    console.error(
      '[source-uniqueness-scorer] Haiku call failed; defaulting all to score=10:',
      err instanceof Error ? err.message : err,
    )
    return {
      scores: sources.map((s) => ({ url: s.url, score: 10 })),
      costUsd: 0,
    }
  }

  let parsed: { scores: Array<{ url?: unknown; score?: unknown }> }
  try {
    parsed = parseJSON(result.text)
  } catch (err) {
    console.warn(
      '[source-uniqueness-scorer] JSON parse failed; defaulting all to score=10:',
      err instanceof Error ? err.message : err,
    )
    return {
      scores: sources.map((s) => ({ url: s.url, score: 10 })),
      costUsd: result.costUsd,
    }
  }

  // Build map of url \u2192 score from response, ignoring extras.
  const scoreByUrl = new Map<string, number>()
  const inputUrls = new Set(sources.map((s) => s.url))
  for (const entry of parsed.scores ?? []) {
    if (typeof entry?.url !== 'string') continue
    if (!inputUrls.has(entry.url)) continue // ignore hallucinated URLs
    scoreByUrl.set(entry.url, normalizeScore(entry.score))
  }

  // Emit one score per input source in input order; missing → 10.
  const scores = sources.map((s) => ({
    url: s.url,
    score: scoreByUrl.get(s.url) ?? 10,
  }))

  return { scores, costUsd: result.costUsd }
}
