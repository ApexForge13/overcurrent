/**
 * Fact-level omission detection.
 *
 * After the debate completes, this runs a Haiku call over ALL the fetched
 * article content and identifies facts present in 50%+ of sources but absent
 * from a meaningful subset.
 *
 * Distinct from the existing regional `Omission` table which tracks
 * "this region's coverage missed X". FactOmission is structured + outlet-linked
 * so the signal layer can compute omissionRate fingerprints per outlet.
 *
 * Cost: ~$0.02-0.05 per analysis (Haiku with large context).
 *
 * MIN_SIGNAL: needs 5+ sources covering the story to detect meaningful omission.
 *             If story has <5 sources with full content, skip detection entirely.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { prisma } from '@/lib/db'
import { normalizeDomain } from '@/lib/outlet-map'

export const FACT_TYPES = [
  'financial_detail',
  'legal_finding',
  'named_individual',
  'government_statement',
  'historical_context',
  'casualty_figure',
] as const

export type FactType = (typeof FACT_TYPES)[number]

export interface DetectedOmission {
  factType: FactType
  factDescription: string
  presentInPct: number              // 0-100
  carriedByOutlets: string[]        // normalized domains
  missedByOutlets: string[]         // normalized domains
}

const SYSTEM_PROMPT = `You detect FACT-LEVEL omissions in news coverage.

Given article content from multiple outlets on the same story, identify facts that:
1. Appear in 50%+ of the articles (verified/common knowledge), AND
2. Are absent from a meaningful subset of other outlets that DID cover the story

For each omission, classify by fact type:
- financial_detail: dollar amounts, percentages, financial figures, market moves
- legal_finding: court rulings, indictments, legal charges, regulatory findings
- named_individual: specific people identified by name/role that others omitted
- government_statement: official quotes or positions that others omitted
- historical_context: precedents, past events, comparative context
- casualty_figure: deaths, injuries, displacement numbers

RULES:
- Focus on CONCRETE, VERIFIABLE facts. Not opinions.
- A fact missing from one outlet that's also not in 50%+ is NOT an omission.
- Limit to the 5-8 most significant omissions. Don't list every minor difference.
- "carriedByOutlets" = domains that include the fact.
- "missedByOutlets" = domains that covered the story (in the input) but omitted the fact.
- Use the outlet domains exactly as provided in the input.

Response format (JSON only, no commentary):
{
  "omissions": [
    {
      "factType": "one_of_6_types",
      "factDescription": "concise fact in 1 sentence",
      "presentInPct": 75,
      "carriedByOutlets": ["domain1.com", "domain2.com"],
      "missedByOutlets": ["domain3.com", "domain4.com"]
    }
  ]
}

If no meaningful omissions exist, return { "omissions": [] }.`

export interface FactOmissionDetectionInput {
  sources: Array<{
    outletDomain: string
    title: string
    content: string           // full article content (or snippet)
  }>
  storyHeadline: string
  minSources?: number         // default 5
  maxContentCharsPerSource?: number // default 2000 (keep prompt manageable)
}

export interface FactOmissionDetectionResult {
  omissions: DetectedOmission[]
  sourcesAnalyzed: number
  skipped: boolean
  skipReason?: string
  costUsd: number
}

const DEFAULT_MIN_SOURCES = 5
const DEFAULT_MAX_CHARS_PER_SOURCE = 2000

/**
 * Detect fact-level omissions in source coverage.
 * Returns empty array if <5 sources (threshold for signal).
 */
export async function detectFactOmissions(
  input: FactOmissionDetectionInput,
  storyId?: string,
): Promise<FactOmissionDetectionResult> {
  const minSources = input.minSources ?? DEFAULT_MIN_SOURCES
  const maxChars = input.maxContentCharsPerSource ?? DEFAULT_MAX_CHARS_PER_SOURCE

  // Dedup by normalized domain — avoid counting The Hill 4x
  const seen = new Set<string>()
  const sources = input.sources.filter((s) => {
    const d = normalizeDomain(s.outletDomain)
    if (seen.has(d)) return false
    if (!s.content || s.content.length < 100) return false
    seen.add(d)
    return true
  })

  if (sources.length < minSources) {
    return {
      omissions: [],
      sourcesAnalyzed: sources.length,
      skipped: true,
      skipReason: `only ${sources.length} sources with content (need ${minSources})`,
      costUsd: 0,
    }
  }

  // Truncate each source to manage prompt size
  const trimmedSources = sources.map((s) => ({
    domain: normalizeDomain(s.outletDomain),
    title: s.title.substring(0, 200),
    content: s.content.substring(0, maxChars),
  }))

  const userPrompt = `Story: ${input.storyHeadline}\n\nSources (${trimmedSources.length}):\n\n${trimmedSources
    .map((s, i) => `[${i + 1}] ${s.domain}\nTitle: ${s.title}\nContent: ${s.content}`)
    .join('\n\n---\n\n')}\n\nDetect fact-level omissions. JSON only.`

  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'fact_omission',
      maxTokens: 4096,
      storyId,
    })

    const parsed = parseJSON<{ omissions?: unknown[] }>(result.text)
    const raw = Array.isArray(parsed?.omissions) ? parsed.omissions : []

    const omissions: DetectedOmission[] = []
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue
      const obj = r as Record<string, unknown>
      const factType = obj.factType as string
      if (!FACT_TYPES.includes(factType as FactType)) {
        console.warn(`[factOmission] Skipping invalid factType: ${factType}`)
        continue
      }
      const description = typeof obj.factDescription === 'string' ? obj.factDescription : ''
      const pct = typeof obj.presentInPct === 'number' ? obj.presentInPct : 0
      const carried = Array.isArray(obj.carriedByOutlets)
        ? obj.carriedByOutlets.filter((d): d is string => typeof d === 'string').map(normalizeDomain)
        : []
      const missed = Array.isArray(obj.missedByOutlets)
        ? obj.missedByOutlets.filter((d): d is string => typeof d === 'string').map(normalizeDomain)
        : []

      if (!description || carried.length === 0 || missed.length === 0) continue

      omissions.push({
        factType: factType as FactType,
        factDescription: description,
        presentInPct: Math.max(0, Math.min(100, pct)),
        carriedByOutlets: [...new Set(carried)],
        missedByOutlets: [...new Set(missed)],
      })
    }

    return {
      omissions,
      sourcesAnalyzed: sources.length,
      skipped: false,
      costUsd: result.costUsd,
    }
  } catch (err) {
    console.error('[factOmission] Detection failed:', err instanceof Error ? err.message : err)
    return {
      omissions: [],
      sourcesAnalyzed: sources.length,
      skipped: true,
      skipReason: `haiku error: ${err instanceof Error ? err.message : 'unknown'}`,
      costUsd: 0,
    }
  }
}

// ── Persistence ────────────────────────────────────────────────────

export interface SaveFactOmissionsInput {
  storyId: string
  storyClusterId: string | null
  storyPhase: string
  omissions: DetectedOmission[]
  isBackfilled?: boolean
}

export async function saveFactOmissions(input: SaveFactOmissionsInput): Promise<number> {
  if (input.omissions.length === 0) return 0

  const data = input.omissions.map((o) => ({
    storyId: input.storyId,
    storyClusterId: input.storyClusterId,
    factType: o.factType,
    factDescription: o.factDescription,
    presentInPct: o.presentInPct,
    carriedByOutlets: JSON.stringify(o.carriedByOutlets),
    missedByOutlets: JSON.stringify(o.missedByOutlets),
    storyPhase: input.storyPhase,
    isBackfilled: input.isBackfilled ?? false,
  }))

  try {
    await prisma.factOmission.createMany({ data })
    return data.length
  } catch (err) {
    console.error('[factOmission] Save failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
