import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'
import type { CongressAction } from '@/ingestion/congress'
import type { FedRegAction } from '@/ingestion/federal-register'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuietActionResult {
  actionType: string
  title: string
  description: string
  date: string
  sourceUrl: string
  mediaCoverage: string
  expectedCoverage: string
  impactScope: string
  severity: 'CRITICAL' | 'NOTABLE' | 'MINOR'
  timingAssessment: string
  significance: string
}

export interface QuietActionScanResult {
  quietActions: QuietActionResult[]
  overallPattern: string
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an Overcurrent quiet action detection agent. Your job is to identify significant government and corporate actions that occurred during a period of peak media distraction — and received little to no coverage.

You will receive:
1. The dominant story that consumed the news cycle and its peak dates
2. A list of government actions (congressional votes, executive orders, regulatory rules) that occurred during this window
3. For each action, the approximate media coverage it received (article count)

Your job:
1. Assess each action's SIGNIFICANCE — how much does it impact the public?
2. Compare significance against coverage — a highly significant action with near-zero coverage is a "quiet action"
3. Determine if the timing could be coincidental or deliberate
4. Note any historical pattern (has this entity timed releases during distractions before?)

Rate each quiet action:
- CRITICAL: Major legislation/order with broad public impact, near-zero coverage
- NOTABLE: Significant regulatory or policy change, minimal coverage
- MINOR: Routine action that happened to have low coverage — not necessarily significant

Do NOT:
- Claim anything was deliberately buried unless there is clear evidence of timing manipulation
- Flag routine administrative actions as suspicious
- Assume correlation = causation — sometimes things just happen at the same time

Use precise language: 'This action received X articles of coverage despite affecting Y million people' rather than 'they buried this.'

Respond with JSON only. No markdown fences.

Response shape:
{
  "quietActions": [
    {
      "actionType": "string",
      "title": "string",
      "description": "string",
      "date": "string",
      "sourceUrl": "string",
      "mediaCoverage": "string",
      "expectedCoverage": "string",
      "impactScope": "string",
      "severity": "CRITICAL | NOTABLE | MINOR",
      "timingAssessment": "string",
      "significance": "string"
    }
  ],
  "overallPattern": "string"
}`

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function scanForQuietActions(
  dominantStory: { headline: string; peakDates: string },
  congressActions: CongressAction[],
  fedRegActions: FedRegAction[],
  mediaCoverageCounts: Array<{ title: string; articleCount: number }>,
  undercurrentReportId?: string,
): Promise<QuietActionScanResult> {
  const userPrompt = `Dominant story:
Headline: ${dominantStory.headline}
Peak dates: ${dominantStory.peakDates}

Congressional actions during this window (${congressActions.length}):
${JSON.stringify(congressActions, null, 2)}

Federal Register actions during this window (${fedRegActions.length}):
${JSON.stringify(fedRegActions, null, 2)}

Media coverage counts per action:
${JSON.stringify(mediaCoverageCounts, null, 2)}`

  const { text, costUsd } = await callClaude({
    model: SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'quiet-action-scanner',
    undercurrentReportId,
  })

  const parsed = parseJSON<Omit<QuietActionScanResult, 'costUsd'>>(text)

  return {
    quietActions: parsed.quietActions ?? [],
    overallPattern: parsed.overallPattern ?? '',
    costUsd,
  }
}
