/**
 * Single-Haiku-call summary path for sources that bypass the full debate
 * under Flag 1 (tiered_source_processing) and — in subsequent turns —
 * Flag 2 (arc_rerun_differential), Flag 3 (semantic_dedup),
 * Flag 5 (regional_debate_pooling).
 *
 * Returns a RegionalAnalysis-shaped object so synthesis treats the haiku
 * output the same as a debate output. The shape is intentionally slimmer:
 * fewer claims, no discrepancies, no detected omissions. Synthesis still
 * sees the source URLs in sourceSummaries so the propagation map and
 * source-count integrity are preserved.
 *
 * Cost target: under $0.02 per region per call. Haiku at $0.80/$4 per MTok
 * with ~2k input + ~500 output = ~$0.0036 typical.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 */

import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import type { RegionalAnalysis } from '@/agents/regional'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceForHaiku {
  url: string
  outlet: string
  title: string
  /** Best-effort article body — may be empty if fetch failed. */
  content?: string
}

/**
 * Caller signature for callClaude. Default is the real callClaude wrapper;
 * tests inject a stub to avoid API spend. Only the fields source-haiku
 * actually reads need typing — `region`/`storyId` are passed through for
 * cost-row attribution.
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

interface HaikuJsonResponse {
  framing: string
  notableAngles: string[]
  sourceSummaries: Array<{ url: string; summary: string }>
  claims: Array<{
    claim: string
    confidence: string
    supportedBy: string[]
  }>
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a fast-pass summarizer for low-tier news sources in the Overcurrent pipeline. You produce a slim regional analysis from emerging or unclassified outlets — sources that did not warrant the full 4-model debate.

Your output is consumed by the synthesis stage alongside debate outputs from higher-tier sources in the same region. Match this contract:
- Be brief. The sources are low-tier; don't over-extract.
- Capture the framing this group of sources used.
- Surface 1-3 specific factual claims if any source makes one. Skip if none.
- Per-source one-sentence summaries (the URL list must survive for the propagation map).

RESPOND WITH JSON ONLY. No markdown, no prose outside the JSON. Shape:
{
  "framing": "1-2 sentence description of how these sources framed the story",
  "notableAngles": ["angle 1", "angle 2"],
  "sourceSummaries": [
    { "url": "<url>", "summary": "<one sentence: outlet + key claim>" }
  ],
  "claims": [
    { "claim": "<specific fact>", "confidence": "HIGH" | "MEDIUM" | "LOW", "supportedBy": ["<outlet name>"] }
  ]
}`

function buildUserPrompt(region: string, query: string, sources: SourceForHaiku[]): string {
  const sourceBlocks = sources
    .map((s, i) => {
      const body = (s.content ?? '').trim().slice(0, 1500) // cap per-source body
      return `[${i + 1}] ${s.outlet}\n  url: ${s.url}\n  title: ${s.title}\n  body: ${body || '(no body fetched)'}`
    })
    .join('\n\n')
  return `REGION: ${region}
QUERY: ${query}
SOURCES (${sources.length}):

${sourceBlocks}

Produce the slim regional analysis JSON.`
}

// ---------------------------------------------------------------------------
// Confidence normalization
// ---------------------------------------------------------------------------

const VALID_CONFIDENCE: ReadonlyArray<RegionalAnalysis['claims'][number]['confidence']> = [
  'HIGH',
  'MEDIUM',
  'LOW',
  'DEVELOPING',
]

function normalizeConfidence(value: unknown): RegionalAnalysis['claims'][number]['confidence'] {
  if (typeof value !== 'string') return 'MEDIUM'
  const upper = value.trim().toUpperCase()
  return (VALID_CONFIDENCE as readonly string[]).includes(upper)
    ? (upper as RegionalAnalysis['claims'][number]['confidence'])
    : 'MEDIUM'
}

// ---------------------------------------------------------------------------
// Stubs for fallback paths
// ---------------------------------------------------------------------------

function emptyStub(region: string): RegionalAnalysis {
  return {
    region,
    claims: [],
    discrepancies: [],
    framingAnalysis: { framing: '', notableAngles: [] },
    omissions: [],
    sourceSummaries: [],
    costUsd: 0,
  }
}

function parseFailureStub(
  region: string,
  sources: SourceForHaiku[],
  costUsd: number,
): RegionalAnalysis {
  return {
    region,
    claims: [],
    discrepancies: [],
    framingAnalysis: {
      framing: 'Could not parse Haiku JSON response — empty framing as fallback',
      notableAngles: [],
    },
    omissions: [],
    // Preserve source URLs so propagation map + source count don't drop them.
    sourceSummaries: sources.map((s) => ({
      url: s.url,
      summary: `${s.outlet}: (Haiku JSON parse failed; URL preserved for source count.)`,
    })),
    costUsd,
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Summarize a group of low-tier sources for one region in a single Haiku call.
 * Returns a RegionalAnalysis stub that synthesis can merge with debate
 * outputs from other sub-paths in the same region.
 *
 * Returns an empty stub (no API call) if sources is empty.
 */
export async function summarizeSourcesViaHaiku(
  region: string,
  sources: ReadonlyArray<SourceForHaiku>,
  query: string,
  opts: { storyId?: string; claudeCaller?: ClaudeCaller } = {},
): Promise<RegionalAnalysis> {
  if (sources.length === 0) return emptyStub(region)

  const caller = opts.claudeCaller ?? (callClaude as unknown as ClaudeCaller)
  const userPrompt = buildUserPrompt(region, query, sources as SourceForHaiku[])

  let result: { text: string; inputTokens: number; outputTokens: number; costUsd: number }
  try {
    result = await caller({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'tiered_haiku_summary',
      maxTokens: 2048,
      region,
      storyId: opts.storyId,
    })
  } catch (err) {
    console.error(
      `[source-haiku-summary] Haiku call failed for region=${region}:`,
      err instanceof Error ? err.message : err,
    )
    return emptyStub(region)
  }

  let parsed: HaikuJsonResponse
  try {
    parsed = parseJSON<HaikuJsonResponse>(result.text)
  } catch (err) {
    console.warn(
      `[source-haiku-summary] JSON parse failed for region=${region}; falling back to stub:`,
      err instanceof Error ? err.message : err,
    )
    return parseFailureStub(region, sources as SourceForHaiku[], result.costUsd)
  }

  // Reorder summaries to match input source ordering. If Haiku omitted or
  // reordered, fill with generic per-source summary so URLs survive.
  const summaryByUrl = new Map<string, string>()
  for (const s of parsed.sourceSummaries ?? []) {
    if (s && typeof s.url === 'string') summaryByUrl.set(s.url, String(s.summary ?? ''))
  }
  const sourceSummaries = (sources as SourceForHaiku[]).map((s) => ({
    url: s.url,
    summary: summaryByUrl.get(s.url) ?? `${s.outlet}: ${s.title}`,
  }))

  const claims = (parsed.claims ?? [])
    .filter((c) => c && typeof c.claim === 'string' && c.claim.length > 0)
    .map((c) => ({
      claim: c.claim,
      confidence: normalizeConfidence(c.confidence),
      supportedBy: Array.isArray(c.supportedBy) ? c.supportedBy.map(String) : [],
      contradictedBy: [] as string[],
      sourcingType: null as string | null,
      notes: 'Haiku-summary path (low-tier source bucket)',
    }))

  return {
    region,
    claims,
    discrepancies: [],
    framingAnalysis: {
      framing: typeof parsed.framing === 'string' ? parsed.framing : '',
      notableAngles: Array.isArray(parsed.notableAngles)
        ? parsed.notableAngles.map(String)
        : [],
    },
    omissions: [],
    sourceSummaries,
    costUsd: result.costUsd,
  }
}
