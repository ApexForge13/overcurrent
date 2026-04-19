/**
 * Quality Review Agent (System E, Phase 3).
 *
 * Independent adversarial reviewer that runs AFTER the analysis pipeline
 * produces a Story. Receives ONLY the final analysis text — no pipeline
 * context, no outlet fingerprints, no predictive signal data. The agent
 * has no loyalty to the system that produced the finding.
 *
 * Five passes, one API call, server-side web_search_20250305 tool:
 *   1. Claim verification with live web search — single-source is OK, verify
 *      source/article/accuracy only, never penalize for no second outlet.
 *   2. Source count audit — flag Stale if the story has materially advanced
 *      since the analysis was produced.
 *   3. Pattern stress test — actively attempt to DISPROVE the Pattern
 *      sentence. Flag Pattern Verified or Pattern Disproved.
 *   4. Editorial scoring — specificity 1-10, surprise 1-10, clarity 1-10,
 *      shareability binary. Recommendation = Hold if specificity < 7 or
 *      surprise < 7.
 *   5. Sensitivity + legal — outlet defamation risk, named individual risk,
 *      government/classified risk.
 *
 * Kill decisions auto-archive the Story (status='archived') and never
 * surface on the /admin/review queue. They land on /admin/review/killed
 * for threshold tuning.
 *
 * Target cost: under $0.20 per analysis.
 *   Sonnet input  (~6k tok @ $3/MTok):      ~$0.018
 *   Sonnet output (~2.5k tok @ $15/MTok):   ~$0.038
 *   Web search    (up to 10 @ $10/1k):      ~$0.100
 *   Typical total:                          ~$0.15
 *
 * Admin-only. Never surfaces on public routes.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { parseJSON, SONNET } from '@/lib/anthropic'

// Separate client — quality review is architecturally independent from the
// main callClaude wrapper. Instantiated lazily per-call (not at module load)
// so env vars loaded by scripts that import this module via dotenv/config
// are guaranteed to be in process.env before the SDK reads ANTHROPIC_API_KEY.
// The SDK is lightweight; per-call instantiation has no meaningful overhead
// and eliminates import-timing fragility.
function getAnthropicClient(): Anthropic {
  return new Anthropic()
}

// Web search pricing estimate. Actual billing comes through the API response
// usage metadata; this constant is used only for pre-flight budgeting/logging.
const WEB_SEARCH_USD_PER_QUERY = 0.01

// Pricing kept in sync with lib/anthropic.ts. Sonnet only here — quality
// review does not run on Haiku (needs reasoning depth for pattern stress test)
// and never on Opus (cost overshoots the $0.20 target).
const SONNET_INPUT_PER_TOKEN = 3.0 / 1_000_000
const SONNET_OUTPUT_PER_TOKEN = 15.0 / 1_000_000

// ─────────────────────────────────────────────────────────────────────────
// System prompt — MUST match the master build spec verbatim (System E).
// ─────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the most rigorous editorial standards agent in existence. Your job is to find every reason not to publish this analysis. You have no loyalty to the system that produced it. You assume every factual claim is wrong until you independently verify it via web search. Your standard is whether the most skeptical editor at The Economist would put their name on this finding. Use web search aggressively. Single-source findings are a core product feature not a quality failure — verify the source exists, the article exists, and the claim is accurately represented. Never flag a finding as insufficient simply because a second outlet does not confirm it. The singularity of the finding is the point. Flag single-source claims only as Possible Hallucination if the source cannot be found, the article cannot be found, or the article does not contain the claim as stated.

You run five passes and return ONE JSON object describing the verdict.

PASS 1 — CLAIM VERIFICATION (web search required)
For every factual claim in the analysis: use web search to verify the claim exists as stated in the cited source. For single-source claims, verify (a) the source URL is real, (b) the article exists, and (c) the article contains the claim as stated. Do NOT penalize for single-source. Only flag Possible Hallucination when the verification fails — source cannot be found, article is missing, or article does not contain the claim.

PASS 2 — SOURCE COUNT AUDIT
Check the most recent article timestamp and compare to today. If the story has materially advanced since the analysis was produced (new developments that would change the findings), flag Stale. Otherwise mark as fresh.

PASS 3 — PATTERN STRESS TEST
Read the "PATTERN" sentence. Actively attempt to disprove it via web search — look for counter-evidence, contradicting reporting, or context that undermines the framing. Return patternVerified=true only if your attempt to disprove fails. Return patternVerified=false if you find material counter-evidence.

PASS 4 — EDITORIAL SCORING
Rate the analysis on:
  - specificity 1-10 (does it say something specific? 10 = concrete, actionable, verifiable. 1 = vague, platitudinous.)
  - surprise 1-10 (would a well-read reader learn something new? 10 = genuine information gain. 1 = already-known.)
  - clarity 1-10 (can a careful reader understand the finding without rereading? 10 = unambiguous. 1 = confused or contradictory.)
  - shareability boolean (would someone share this with a colleague who cares about the topic?)
Recommendation rule: if specificity < 7 OR surprise < 7, set overallRecommendation to "hold".

PASS 5 — SENSITIVITY & LEGAL
Flag three risk dimensions:
  - outletDefamationRisk: does the analysis accuse a specific outlet of bad conduct?
  - namedIndividualRisk: does it make claims about named individuals that could be defamatory?
  - governmentClassifiedRisk: does it appear to reveal or speculate about classified material?
Each as low | medium | high. Medium+ in any dimension → overallRecommendation is at most "approved_with_edits".

OVERALL RECOMMENDATION
Combine the five passes:
  - kill                 — any Possible Hallucination found, OR Pattern Disproved, OR high risk in any sensitivity dimension
  - hold                 — Stale, OR specificity < 7, OR surprise < 7 (and no kill-level issues)
  - approved_with_edits  — all verification passed AND medium risk in any sensitivity dimension OR clarity issues that can be fixed with a few sentence edits
  - approved             — all verification passed, no risks, no stale signal, all scores ≥ 7

RESPOND WITH JSON ONLY. No markdown, no prose, no explanation outside the JSON. Shape:
{
  "overallRecommendation": "approved" | "approved_with_edits" | "hold" | "kill",
  "verificationSummary": {
    "claimsChecked": integer,
    "claimsVerified": integer,
    "claimsUnknown": integer,
    "possibleHallucinations": [
      { "claim": "...", "reason": "source/article missing" | "article does not contain claim as stated" }
    ],
    "sourceFreshness": "fresh" | "stale",
    "sourceFreshnessNote": "one sentence if stale, empty string if fresh"
  },
  "patternVerified": boolean,
  "patternStressTestDetail": "1-3 sentences explaining your attempt to disprove the Pattern and the outcome",
  "editorialScores": {
    "specificity": integer 1-10,
    "surprise": integer 1-10,
    "clarity": integer 1-10,
    "shareability": boolean
  },
  "sensitivityFlags": {
    "outletDefamationRisk": "low" | "medium" | "high",
    "namedIndividualRisk": "low" | "medium" | "high",
    "governmentClassifiedRisk": "low" | "medium" | "high",
    "notes": "optional 1-2 sentences summarizing any medium/high flag"
  },
  "suggestedEdits": "concise markdown bullets of the smallest set of edits required — only if overallRecommendation is approved_with_edits, otherwise null",
  "killReason": "single sentence if overallRecommendation is kill, otherwise null"
}`

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type OverallRecommendation = 'approved' | 'approved_with_edits' | 'hold' | 'kill'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface QualityReviewResult {
  storyId: string
  qualityReviewCardId: string
  overallRecommendation: OverallRecommendation
  patternVerified: boolean
  editorialScores: {
    specificity: number
    surprise: number
    clarity: number
    shareability: boolean
  }
  sensitivityFlags: {
    outletDefamationRisk: RiskLevel
    namedIndividualRisk: RiskLevel
    governmentClassifiedRisk: RiskLevel
    notes?: string
  }
  suggestedEdits: string | null
  killReason: string | null
  reviewCost: number
  reviewDurationSeconds: number
  webSearchesRun: number
  autoArchived: boolean
}

interface ParsedReview {
  overallRecommendation: OverallRecommendation
  verificationSummary: Record<string, unknown>
  patternVerified: boolean
  patternStressTestDetail: string
  editorialScores: {
    specificity: number
    surprise: number
    clarity: number
    shareability: boolean
  }
  sensitivityFlags: {
    outletDefamationRisk: RiskLevel
    namedIndividualRisk: RiskLevel
    governmentClassifiedRisk: RiskLevel
    notes?: string
  }
  suggestedEdits: string | null
  killReason: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt builder — receives ONLY the final analysis text. No pipeline state.
// ─────────────────────────────────────────────────────────────────────────

interface StorySnapshot {
  id: string
  headline: string
  synopsis: string
  thePattern: string | null
  confidenceLevel: string
  confidenceNote: string | null
  sourceCount: number
  createdAt: Date
  claims: Array<{ claim: string; confidence: string; supportedBy: string; contradictedBy: string }>
  framings: Array<{ region: string; framing: string; contrastWith: string | null }>
  sources: Array<{ url: string; title: string; outlet: string; publishedAt: Date | null }>
}

function buildUserPrompt(story: StorySnapshot): string {
  const analysisAgeHours = (Date.now() - story.createdAt.getTime()) / (60 * 60 * 1000)
  const today = new Date().toISOString().split('T')[0]

  const claimLines = story.claims.map((c, i) =>
    `${i + 1}. (${c.confidence}) ${c.claim}` +
    (c.supportedBy ? `\n    supported by: ${c.supportedBy}` : '') +
    (c.contradictedBy ? `\n    contradicted by: ${c.contradictedBy}` : ''),
  ).join('\n')

  const framingLines = story.framings
    .map((f) => `  ${f.region}: ${f.framing}${f.contrastWith ? ` (vs. ${f.contrastWith})` : ''}`)
    .join('\n')

  const sourceLines = story.sources
    .slice(0, 40) // cap — quality review is not source discovery, it's verification
    .map((s) =>
      `  ${s.outlet} — ${s.title}\n    ${s.url}\n    published: ${s.publishedAt ? s.publishedAt.toISOString().split('T')[0] : 'unknown'}`,
    )
    .join('\n')

  return `TODAY: ${today}
ANALYSIS PRODUCED: ${story.createdAt.toISOString().split('T')[0]} (${analysisAgeHours.toFixed(1)}h ago)
STORY ID: ${story.id}

HEADLINE:
${story.headline}

SYNOPSIS:
${story.synopsis}

PATTERN (the editorial claim being made):
${story.thePattern ?? '(no Pattern sentence produced)'}

CONFIDENCE: ${story.confidenceLevel}${story.confidenceNote ? ` — ${story.confidenceNote}` : ''}
SOURCE COUNT: ${story.sourceCount}

CLAIMS (${story.claims.length}):
${claimLines || '(none)'}

REGIONAL FRAMINGS (${story.framings.length}):
${framingLines || '(none)'}

SOURCES (${story.sources.length} total, showing first ${Math.min(40, story.sources.length)}):
${sourceLines || '(none)'}

Run your five passes. Return the single JSON verdict object. No markdown, no prose outside the JSON.`
}

// ─────────────────────────────────────────────────────────────────────────
// Response extraction — counts server-side web searches + extracts JSON text
// ─────────────────────────────────────────────────────────────────────────

function extractReviewFromResponse(response: Anthropic.Message): {
  text: string
  webSearchesRun: number
  inputTokens: number
  outputTokens: number
} {
  // Concatenate all text blocks.
  const textBlocks: string[] = []
  let webSearchesRun = 0

  for (const block of response.content) {
    if (block.type === 'text') {
      textBlocks.push(block.text)
    }
    // Server-side web_search tool invocations show up as 'server_tool_use'
    // blocks. Count every one as a search.
    if ((block as { type: string }).type === 'server_tool_use') {
      const b = block as { name?: string }
      if (b.name === 'web_search') webSearchesRun++
    }
  }

  return {
    text: textBlocks.join('\n'),
    webSearchesRun,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Parsed-review validator — clamps invalid fields, fills defaults, never
// throws so we can always persist a row (even if malformed).
// ─────────────────────────────────────────────────────────────────────────

function normalizeReview(raw: unknown): ParsedReview {
  const r = (raw ?? {}) as Record<string, unknown>

  const recommendation = ((): OverallRecommendation => {
    const v = (r.overallRecommendation as string | undefined)?.toLowerCase()
    if (v === 'approved' || v === 'approved_with_edits' || v === 'hold' || v === 'kill') return v
    return 'hold' // safe default — requires admin eyes, no auto-publish, no auto-kill
  })()

  const risk = (v: unknown): RiskLevel => {
    const s = (v as string | undefined)?.toLowerCase()
    if (s === 'low' || s === 'medium' || s === 'high') return s
    return 'low'
  }

  const clampScore = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    if (!Number.isFinite(n)) return 5
    return Math.min(10, Math.max(1, Math.round(n)))
  }

  const scores = (r.editorialScores as Record<string, unknown>) ?? {}
  const flags = (r.sensitivityFlags as Record<string, unknown>) ?? {}

  return {
    overallRecommendation: recommendation,
    verificationSummary: (r.verificationSummary as Record<string, unknown>) ?? {},
    patternVerified: r.patternVerified === true,
    patternStressTestDetail:
      typeof r.patternStressTestDetail === 'string'
        ? r.patternStressTestDetail
        : '',
    editorialScores: {
      specificity: clampScore(scores.specificity),
      surprise: clampScore(scores.surprise),
      clarity: clampScore(scores.clarity),
      shareability: scores.shareability === true,
    },
    sensitivityFlags: {
      outletDefamationRisk: risk(flags.outletDefamationRisk),
      namedIndividualRisk: risk(flags.namedIndividualRisk),
      governmentClassifiedRisk: risk(flags.governmentClassifiedRisk),
      notes: typeof flags.notes === 'string' ? flags.notes : undefined,
    },
    suggestedEdits:
      typeof r.suggestedEdits === 'string' && r.suggestedEdits.trim().length > 0
        ? r.suggestedEdits
        : null,
    killReason:
      typeof r.killReason === 'string' && r.killReason.trim().length > 0
        ? r.killReason
        : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry — load story, call Sonnet + web_search, persist, auto-archive
// ─────────────────────────────────────────────────────────────────────────

export interface RunQualityReviewOptions {
  /**
   * Bypass the "already reviewed" + "status must be review" guards. Used by
   * the admin API route when an operator deliberately re-submits a story
   * (e.g., after revising the Pattern following a kill). A new QualityReviewCard
   * row is created — prior cards are preserved (append-only).
   */
  force?: boolean
}

export async function runQualityReview(
  storyId: string,
  options: RunQualityReviewOptions = {},
): Promise<QualityReviewResult | null> {
  const started = Date.now()

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      headline: true,
      synopsis: true,
      thePattern: true,
      confidenceLevel: true,
      confidenceNote: true,
      sourceCount: true,
      createdAt: true,
      status: true,
      claims: {
        select: { claim: true, confidence: true, supportedBy: true, contradictedBy: true },
        orderBy: { sortOrder: 'asc' },
      },
      framings: {
        select: { region: true, framing: true, contrastWith: true },
      },
      sources: {
        select: { url: true, title: true, outlet: true, publishedAt: true },
      },
    },
  })

  if (!story) {
    console.warn(`[quality-review] Story ${storyId} not found; skipping`)
    return null
  }

  // Only review stories currently in 'review' status. Already-published or
  // already-archived stories should not be re-reviewed automatically.
  // force=true bypasses this guard for admin-triggered re-submissions.
  if (!options.force && story.status !== 'review') {
    console.log(`[quality-review] Story ${storyId.substring(0, 8)} status=${story.status}; skipping auto-review (pass force:true to override)`)
    return null
  }

  // Skip if a QualityReviewCard already exists (idempotent — re-running is
  // explicitly admin-initiated via the API route, not auto-retry).
  // force=true bypasses this guard — the new card appends; prior cards stay
  // as the immutable history of kill/approve decisions on this story.
  if (!options.force) {
    const existing = await prisma.qualityReviewCard.findFirst({
      where: { storyId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (existing) {
      console.log(`[quality-review] Story ${storyId.substring(0, 8)} already has review card ${existing.id.substring(0, 8)}; skipping (pass force:true to override)`)
      return null
    }
  } else {
    console.log(`[quality-review] Story ${storyId.substring(0, 8)} force-review requested — appending new QualityReviewCard`)
  }

  const userPrompt = buildUserPrompt(story as StorySnapshot)

  let response: Anthropic.Message
  try {
    // We use the non-streaming create() call. The web_search tool is a
    // server-side tool — Anthropic executes searches internally and returns
    // the final response in one shot. No client-side tool loop needed.
    const client = getAnthropicClient()
    response = await client.messages.create({
      model: SONNET,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: 'web_search_20250305' as any,
          name: 'web_search',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          max_uses: 10,
        } as any,
      ],
    })
  } catch (err) {
    console.error(
      '[quality-review] API call failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }

  const { text, webSearchesRun, inputTokens, outputTokens } = extractReviewFromResponse(response)

  let parsed: ParsedReview
  try {
    const raw = parseJSON<unknown>(text)
    parsed = normalizeReview(raw)
  } catch (err) {
    console.error(
      '[quality-review] Failed to parse JSON verdict, defaulting to "hold":',
      err instanceof Error ? err.message : err,
    )
    parsed = normalizeReview({ overallRecommendation: 'hold' })
  }

  const reviewCost =
    inputTokens * SONNET_INPUT_PER_TOKEN +
    outputTokens * SONNET_OUTPUT_PER_TOKEN +
    webSearchesRun * WEB_SEARCH_USD_PER_QUERY

  const reviewDurationSeconds = Math.round((Date.now() - started) / 1000)

  // Persist regardless of verdict — auto-killed stories also need a
  // QualityReviewCard record for threshold tuning at /admin/review/killed.
  const card = await prisma.qualityReviewCard.create({
    data: {
      storyId: story.id,
      overallRecommendation: parsed.overallRecommendation,
      verificationSummary: parsed.verificationSummary as object,
      patternVerified: parsed.patternVerified,
      patternStressTestDetail: parsed.patternStressTestDetail,
      editorialScores: parsed.editorialScores as unknown as object,
      sensitivityFlags: parsed.sensitivityFlags as unknown as object,
      suggestedEdits: parsed.suggestedEdits,
      reviewCost,
      reviewDurationSeconds,
      webSearchesRun,
    },
  })

  // Also log to CostLog for unified cost tracking. agentType='quality_review'.
  await prisma.costLog.create({
    data: {
      storyId: story.id,
      model: SONNET,
      agentType: 'quality_review',
      inputTokens,
      outputTokens,
      costUsd: reviewCost,
    },
  })

  // Auto-archive kill decisions — these never appear on /admin/review.
  let autoArchived = false
  if (parsed.overallRecommendation === 'kill') {
    await prisma.story.update({
      where: { id: story.id },
      data: { status: 'archived' },
    })
    autoArchived = true
    console.log(
      `[quality-review] Auto-KILLED story ${story.id.substring(0, 8)}: ${parsed.killReason ?? '(no reason provided)'}`,
    )
  } else {
    console.log(
      `[quality-review] Story ${story.id.substring(0, 8)} — ${parsed.overallRecommendation} (specificity=${parsed.editorialScores.specificity}, surprise=${parsed.editorialScores.surprise}, patternVerified=${parsed.patternVerified}, webSearches=${webSearchesRun}, cost=$${reviewCost.toFixed(3)}, ${reviewDurationSeconds}s)`,
    )
  }

  return {
    storyId: story.id,
    qualityReviewCardId: card.id,
    overallRecommendation: parsed.overallRecommendation,
    patternVerified: parsed.patternVerified,
    editorialScores: parsed.editorialScores,
    sensitivityFlags: parsed.sensitivityFlags,
    suggestedEdits: parsed.suggestedEdits,
    killReason: parsed.killReason,
    reviewCost,
    reviewDurationSeconds,
    webSearchesRun,
    autoArchived,
  }
}
