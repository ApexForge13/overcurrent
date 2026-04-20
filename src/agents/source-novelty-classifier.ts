/**
 * Flag 2 (arc_rerun_differential) source novelty classifier.
 *
 * Single Haiku call that batch-classifies each source as:
 *   - new_since_last_run    \u2192 routes to full debate (per its tier-based path)
 *   - continuing_coverage   \u2192 routes to haiku summary (cost saver)
 *
 * Compares source publishedAt + content cues against the previous arc analysis's
 * createdAt + headline + key claims. Conservative on every fallback: missing
 * classifications, unknown novelty values, JSON parse failures, and Haiku call
 * errors all default to continuing_coverage so we never accidentally over-spend
 * on debate when the classifier is uncertain.
 *
 * Cost target: under $0.01 per analysis (one Haiku call regardless of source
 * count). Haiku at $0.80/$4 per MTok with ~1.5k input + ~300 output \u2248 $0.0024.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Novelty = 'new_since_last_run' | 'continuing_coverage'

export interface SourceForNoveltyClassification {
  url: string
  title: string
  /** Best-effort article body \u2014 truncated server-side; may be empty if fetch failed. */
  content?: string
  /** ISO timestamp from RSS/GDELT. May be empty/undefined for some sources. */
  publishedAt?: string
}

export interface ClassifierBaseline {
  /** createdAt of the most recent prior Story in this cluster. */
  previousAnalysisCreatedAt: Date
  /** Headline of the prior Story \u2014 helps Haiku identify "rehash" coverage. */
  previousHeadline: string
  /** Top claims from the prior analysis. Helps detect content overlap. */
  previousKeyClaims: string[]
}

export interface NoveltyClassification {
  url: string
  novelty: Novelty
}

export interface ClassifierResult {
  classifications: NoveltyClassification[]
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

const SYSTEM_PROMPT = `You are an arc-rerun novelty classifier in the Overcurrent pipeline. The system has already produced a previous analysis of this story. You receive (a) the previous analysis context and (b) a fresh batch of sources from a re-run.

Your job: for each source, decide whether it represents NEW information since the previous analysis, or CONTINUING COVERAGE that mostly rehashes what was already known.

A source is "new_since_last_run" when it:
- Reports a development that happened AFTER the previous analysis was produced
- Adds a previously-undocumented fact, source, or quote on this story
- Names an outlet, official, or quantitative figure not in the previous claims

A source is "continuing_coverage" when it:
- Recaps or summarizes the prior reporting without adding new facts
- Was published BEFORE or DURING the previous analysis window
- Repeats claims already made in the previous analysis without new sourcing

When uncertain, label as "continuing_coverage" \u2014 the cost system prefers under-debating to over-classifying.

RESPOND WITH JSON ONLY. No markdown, no prose outside the JSON. Shape:
{
  "classifications": [
    { "url": "<url>", "novelty": "new_since_last_run" | "continuing_coverage" }
  ]
}

You MUST include one classification per input source. Use the source URL exactly as provided.`

function buildUserPrompt(
  sources: ReadonlyArray<SourceForNoveltyClassification>,
  baseline: ClassifierBaseline,
  query: string,
): string {
  const baselineISO = baseline.previousAnalysisCreatedAt.toISOString()
  const claimsBlock = baseline.previousKeyClaims
    .slice(0, 8) // cap at 8 to keep prompt size bounded
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join('\n')

  const sourceBlocks = sources
    .map((s, i) => {
      const body = (s.content ?? '').trim().slice(0, 800)
      return `[${i + 1}] ${s.url}\n  publishedAt: ${s.publishedAt ?? '(unknown)'}\n  title: ${s.title}\n  body: ${body || '(no body fetched)'}`
    })
    .join('\n\n')

  return `QUERY: ${query}

PREVIOUS ANALYSIS (createdAt: ${baselineISO})
Headline: ${baseline.previousHeadline}
Key claims:
${claimsBlock || '  (none provided)'}

NEW SOURCE BATCH (${sources.length} sources):

${sourceBlocks}

Classify each source. Return the JSON.`
}

// ---------------------------------------------------------------------------
// Novelty normalization
// ---------------------------------------------------------------------------

const VALID_NOVELTY: ReadonlySet<Novelty> = new Set(['new_since_last_run', 'continuing_coverage'])

function normalizeNovelty(value: unknown): Novelty {
  if (typeof value !== 'string') return 'continuing_coverage'
  const lower = value.trim().toLowerCase()
  if (VALID_NOVELTY.has(lower as Novelty)) return lower as Novelty
  return 'continuing_coverage'
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Classify a batch of sources by novelty against a previous analysis baseline.
 * Always returns one classification per input source, in input order.
 * Conservative on every fallback path \u2014 missing/unknown/error \u2192 continuing_coverage.
 */
export async function classifySourceNovelty(
  sources: ReadonlyArray<SourceForNoveltyClassification>,
  baseline: ClassifierBaseline,
  query: string,
  opts: { storyId?: string; claudeCaller?: ClaudeCaller } = {},
): Promise<ClassifierResult> {
  if (sources.length === 0) return { classifications: [], costUsd: 0 }

  const caller = opts.claudeCaller ?? (callClaude as unknown as ClaudeCaller)
  const userPrompt = buildUserPrompt(sources, baseline, query)

  let result: { text: string; inputTokens: number; outputTokens: number; costUsd: number }
  try {
    result = await caller({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'arc_rerun_novelty',
      maxTokens: 2048,
      storyId: opts.storyId,
    })
  } catch (err) {
    console.error(
      '[source-novelty-classifier] Haiku call failed; defaulting all to continuing_coverage:',
      err instanceof Error ? err.message : err,
    )
    return {
      classifications: sources.map((s) => ({ url: s.url, novelty: 'continuing_coverage' as const })),
      costUsd: 0,
    }
  }

  let parsed: { classifications: Array<{ url?: unknown; novelty?: unknown }> }
  try {
    parsed = parseJSON(result.text)
  } catch (err) {
    console.warn(
      '[source-novelty-classifier] JSON parse failed; defaulting all to continuing_coverage:',
      err instanceof Error ? err.message : err,
    )
    return {
      classifications: sources.map((s) => ({ url: s.url, novelty: 'continuing_coverage' as const })),
      costUsd: result.costUsd,
    }
  }

  // Build a map of url \u2192 novelty from Haiku response, ignoring extras.
  const noveltyByUrl = new Map<string, Novelty>()
  const inputUrls = new Set(sources.map((s) => s.url))
  for (const c of parsed.classifications ?? []) {
    if (typeof c?.url !== 'string') continue
    if (!inputUrls.has(c.url)) continue // ignore hallucinated URLs
    noveltyByUrl.set(c.url, normalizeNovelty(c.novelty))
  }

  // Emit one classification per input source in input order.
  const classifications = sources.map((s) => ({
    url: s.url,
    novelty: noveltyByUrl.get(s.url) ?? ('continuing_coverage' as const),
  }))

  return { classifications, costUsd: result.costUsd }
}
