import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'
import type { DisplacedStoryResult } from '@/agents/displacement-scanner'
import type { QuietActionResult } from '@/agents/quiet-action-scanner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UndercurrentSynthesisResult {
  headline: string
  synopsis: string
  dominantStorySaturation: {
    totalArticles: number
    totalOutlets: number
    peakDate: string
    daysOfDominance: number
    pctOfTotalNewsCycle: number
  }
  displacementSummary: string
  quietActionSummary: string
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW'
  riskReasoning: string
  keyTakeaways: string[]
  followUpItems: string[]
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Overcurrent synthesis engine for undercurrent reports. You produce reports that document what happened UNDER the surface of the dominant news cycle.

You receive:
1. The dominant story that consumed the news cycle
2. Displaced stories — topics that lost coverage when the dominant story hit
3. Quiet actions — government and corporate actions that occurred with minimal coverage during the distraction window

CORE PRINCIPLES:
1. YOU DOCUMENT PATTERNS. You do NOT claim conspiracy.
2. When timing is suspicious, say 'the timing is notable' — not 'they did this on purpose.'
3. When coverage drops are dramatic, present the numbers — don't editorialize.
4. Every claim must be supported by data: article counts, dates, volume changes.
5. Let the reader decide what the pattern means.
6. Distinguish between 'this was likely buried' and 'this just happened to coincide.'
7. The most valuable insight is: 'Here is what you missed and why it matters.'

Write for someone who is smart, skeptical, and tired of being distracted by noise.

Respond with JSON only. No markdown fences.

Response shape:
{
  "headline": "string",
  "synopsis": "string (markdown, ~5 paragraphs)",
  "dominant_story_saturation": {
    "totalArticles": 0,
    "totalOutlets": 0,
    "peakDate": "string",
    "daysOfDominance": 0,
    "pctOfTotalNewsCycle": 0
  },
  "displacement_summary": "string",
  "quiet_action_summary": "string",
  "risk_level": "HIGH | MEDIUM | LOW",
  "risk_reasoning": "string",
  "key_takeaways": ["string"],
  "follow_up_items": ["string"]
}`

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function synthesizeUndercurrent(
  dominantStory: {
    headline: string
    description: string
    articleCount: number
    outletCount: number
    peakDate: string
    daysOfDominance: number
  },
  displacedStories: DisplacedStoryResult[],
  quietActions: QuietActionResult[],
  timingAnomalies: Array<{
    event: string
    timing: string
    pattern: string
    significance: string
  }>,
  undercurrentReportId?: string,
): Promise<UndercurrentSynthesisResult> {
  const userPrompt = `Dominant story:
${JSON.stringify(dominantStory, null, 2)}

Displaced stories (${displacedStories.length}):
${JSON.stringify(displacedStories, null, 2)}

Quiet actions (${quietActions.length}):
${JSON.stringify(quietActions, null, 2)}

Timing anomalies (${timingAnomalies.length}):
${JSON.stringify(timingAnomalies, null, 2)}`

  const { text, costUsd } = await callClaude({
    model: SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'undercurrent-synthesis',
    undercurrentReportId,
  })

  // The LLM responds with snake_case keys per the prompt; normalize to camelCase
  const parsed = parseJSON<Record<string, unknown>>(text)

  const saturation = (parsed.dominant_story_saturation ?? parsed.dominantStorySaturation ?? {}) as Record<string, unknown>

  return {
    headline: String(parsed.headline ?? ''),
    synopsis: String(parsed.synopsis ?? ''),
    dominantStorySaturation: {
      totalArticles: Number(saturation.totalArticles ?? 0),
      totalOutlets: Number(saturation.totalOutlets ?? 0),
      peakDate: String(saturation.peakDate ?? ''),
      daysOfDominance: Number(saturation.daysOfDominance ?? 0),
      pctOfTotalNewsCycle: Number(saturation.pctOfTotalNewsCycle ?? 0),
    },
    displacementSummary: String(parsed.displacement_summary ?? parsed.displacementSummary ?? ''),
    quietActionSummary: String(parsed.quiet_action_summary ?? parsed.quietActionSummary ?? ''),
    riskLevel: (parsed.risk_level ?? parsed.riskLevel ?? 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
    riskReasoning: String(parsed.risk_reasoning ?? parsed.riskReasoning ?? ''),
    keyTakeaways: (parsed.key_takeaways ?? parsed.keyTakeaways ?? []) as string[],
    followUpItems: (parsed.follow_up_items ?? parsed.followUpItems ?? []) as string[],
    costUsd,
  }
}
