import { callClaude, parseJSON, SONNET } from '@/lib/anthropic'
import { ANTI_HALLUCINATION_RULES, LANGUAGE_RULES, JSON_RULES } from './prompts'
import type { VolumeDataPoint } from '@/ingestion/gdelt-volume'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisplacedStoryResult {
  headline: string
  topicKeywords: string[]
  peakCoverage: string
  dropoffDate: string
  coverageDropPct: number
  currentStatus: string
  wasResolved: boolean
  resolutionNote: string
  displacementLevel: 'HIGH' | 'MEDIUM' | 'LOW'
  significance: string
  sampleSources: string[]
}

export interface DisplacementScanResult {
  displacedStories: DisplacedStoryResult[]
  analysisNote: string
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an Overcurrent displacement detection agent. Your job is to identify news stories that were gaining coverage momentum but suddenly lost it when a dominant story took over the news cycle.

You will receive:
1. The dominant story that consumed the news cycle
2. A list of other stories with their coverage volume data (daily article counts over a 2-week window)
3. The date range when the dominant story peaked

For each story in the list, determine:
- Was it gaining coverage BEFORE the dominant story peaked? (look for upward volume trend)
- Did coverage DROP significantly (>50%) during or after the dominant story?
- Did coverage RECOVER after the dominant story died down, or did it stay dead?
- Was the story RESOLVED (reached a natural conclusion) or did it just DISAPPEAR?

A story is "displaced" if:
- It had rising coverage (3+ consecutive days of growth OR a clear upward trend)
- Coverage dropped 50%+ coinciding with the dominant story's peak
- The story was NOT resolved — it didn't reach a natural conclusion, it just vanished

Rate each displaced story:
- HIGH displacement: >75% drop, unresolved, significant public interest topic
- MEDIUM displacement: 50-75% drop, unclear resolution, moderate public interest
- LOW displacement: 50%+ drop but story may have naturally concluded anyway

Do NOT flag stories that:
- Reached a natural conclusion (verdict delivered, election happened, deal closed)
- Were already declining before the dominant story hit
- Are trivial/celebrity/entertainment unless they involve public interest issues

You are NOT claiming conspiracy. You are documenting coverage patterns. Let the data speak.

${ANTI_HALLUCINATION_RULES}

${LANGUAGE_RULES}

${JSON_RULES}

Response shape:
{
  "displacedStories": [
    {
      "headline": "string",
      "topicKeywords": ["string"],
      "peakCoverage": "string",
      "dropoffDate": "string",
      "coverageDropPct": 0,
      "currentStatus": "string",
      "wasResolved": false,
      "resolutionNote": "string",
      "displacementLevel": "HIGH | MEDIUM | LOW",
      "significance": "string",
      "sampleSources": ["string"]
    }
  ],
  "analysisNote": "string"
}`

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function scanForDisplacement(
  dominantStory: { headline: string; description: string; peakDate: string },
  otherTopics: Array<{ theme: string; volumeData: VolumeDataPoint[] }>,
  undercurrentReportId?: string,
): Promise<DisplacementScanResult> {
  const userPrompt = `Dominant story:
Headline: ${dominantStory.headline}
Description: ${dominantStory.description}
Peak date: ${dominantStory.peakDate}

Other topics with daily volume data (${otherTopics.length} topics):
${JSON.stringify(
  otherTopics.map((t) => ({
    theme: t.theme,
    volumeData: t.volumeData,
  })),
  null,
  2,
)}`

  const { text, costUsd } = await callClaude({
    model: SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'displacement-scanner',
    undercurrentReportId,
  })

  const parsed = parseJSON<Omit<DisplacementScanResult, 'costUsd'>>(text)

  return {
    displacedStories: parsed.displacedStories ?? [],
    analysisNote: parsed.analysisNote ?? '',
    costUsd,
  }
}
