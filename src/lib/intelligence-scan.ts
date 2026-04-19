import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { prisma } from '@/lib/db'

/**
 * Umbrella Intelligence Scan (Session 3 Step 4)
 *
 * Lightweight Haiku call (~$0.01-$0.03) that surfaces sub-event candidates under
 * an umbrella. Does NOT ingest articles. Does NOT run the debate pipeline.
 * Returns recommendations only — nothing auto-executes.
 *
 * MIN_SIGNAL: scan recommendations are early signal only below 5 accumulated
 *             analyses under the umbrella. The admin UI attaches an "Early
 *             Signal — Limited Data" badge to recommendations until the
 *             umbrella has at least 5 nested analyses.
 */

export type RecommendationKind = 'story_arc' | 'one_off'
export type EstimatedPhase = 'first_wave' | 'development' | 'consolidation' | 'tail' | null

export interface Recommendation {
  suggestedLabel: string
  recommendation: RecommendationKind
  rationale: string                      // one sentence
  estimatedPhase: EstimatedPhase
}

export interface IntelligenceScanResult {
  scanId: string
  umbrellaArcId: string
  ranAt: Date
  recommendations: Recommendation[]
  limitedData: boolean                    // true when umbrella has <5 analyses
  costUsd: number
}

const SYSTEM_PROMPT = `You are an umbrella intelligence scanner for Overcurrent, a news-coverage analysis platform.

An "umbrella" is a long-running topic container (e.g. "US-Iran Escalation 2026"). Under each umbrella the admin files two kinds of analyses:
  - story_arc   — a bounded event that will be re-analyzed across 4 phases (first_wave → development → consolidation → tail)
  - one_off     — a single analysis tagged to the umbrella with no re-run schedule

YOUR JOB: given the umbrella's name, description, signal category, and the list of arcs + one-offs already filed, suggest 3-5 candidate sub-events that an analyst could plausibly file NEXT under this umbrella.

For each candidate:
  - suggestedLabel: short descriptor (≤ 60 chars)
  - recommendation: "story_arc" if this will plausibly have multiple phases worth tracking, "one_off" if it's a discrete event
  - rationale: ONE SENTENCE explaining why this is worth filing
  - estimatedPhase: the initial phase the analyst would likely file (first_wave for breaking, development for 12-48h in, consolidation for 2-7d, tail for 7d+). Use null if not applicable.

RULES:
  - Never duplicate an existing arc or one-off label.
  - Prefer suggestedLabels that are CONCRETE ENTITIES or EVENTS, not generic themes.
  - Keep the list short (3-5 entries). Quality over quantity.
  - If the umbrella is too new or too narrow to produce meaningful candidates, return an empty array.

CRITICAL: Response must be ONLY a valid JSON object. No markdown, no prose before or after. Start with { and end with }.

Response shape:
{
  "recommendations": [
    {
      "suggestedLabel": "string",
      "recommendation": "story_arc" | "one_off",
      "rationale": "one sentence",
      "estimatedPhase": "first_wave" | "development" | "consolidation" | "tail" | null
    }
  ]
}`

export async function runIntelligenceScan(
  umbrellaArcId: string,
): Promise<IntelligenceScanResult> {
  const umbrella = await prisma.umbrellaArc.findUnique({
    where: { id: umbrellaArcId },
    select: {
      id: true,
      name: true,
      description: true,
      signalCategory: true,
      totalAnalyses: true,
    },
  })
  if (!umbrella) throw new Error(`Umbrella not found: ${umbrellaArcId}`)

  const analyses = await prisma.story.findMany({
    where: { umbrellaArcId, analysisType: { in: ['new_arc', 'umbrella_tagged', 'arc_rerun'] } },
    select: {
      id: true,
      analysisType: true,
      arcLabel: true,
      headline: true,
      arcImportance: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Separate existing arcs from one-offs for the prompt
  const existingArcs = analyses
    .filter(a => a.analysisType === 'new_arc')
    .map(a => ({ label: a.arcLabel ?? a.headline, importance: a.arcImportance }))

  const existingOneOffs = analyses
    .filter(a => a.analysisType === 'umbrella_tagged')
    .map(a => a.arcLabel ?? a.headline)

  const userPrompt = `UMBRELLA
  name: ${umbrella.name}
  description: ${umbrella.description ?? '(none)'}
  signalCategory: ${umbrella.signalCategory}
  totalAnalyses: ${umbrella.totalAnalyses}

EXISTING STORY ARCS (${existingArcs.length})
${existingArcs.length > 0 ? existingArcs.map(a => `  - ${a.label} [${a.importance ?? 'reference'}]`).join('\n') : '  (none)'}

EXISTING ONE-OFFS (${existingOneOffs.length})
${existingOneOffs.length > 0 ? existingOneOffs.map(l => `  - ${l}`).join('\n') : '  (none)'}

Return 3-5 recommended candidates. JSON only.`

  const result = await callClaude({
    model: HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'intelligence_scan',
    maxTokens: 2048,
  })

  let recommendations: Recommendation[] = []
  try {
    const parsed = parseJSON<{ recommendations?: Recommendation[] }>(result.text)
    recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : []
  } catch (err) {
    console.warn('[intelligence-scan] Haiku parse failed — storing raw output for debugging', err)
    recommendations = []
  }

  // Defensive filtering: drop malformed entries
  recommendations = recommendations.filter(r =>
    typeof r.suggestedLabel === 'string' && r.suggestedLabel.trim().length > 0 &&
    (r.recommendation === 'story_arc' || r.recommendation === 'one_off') &&
    typeof r.rationale === 'string',
  )

  const scan = await prisma.$transaction(async (tx) => {
    const row = await tx.umbrellaIntelligenceScan.create({
      data: {
        umbrellaArcId,
        recommendationsGenerated: recommendations.length,
        recommendationsTriggered: 0,
        rawOutput: JSON.stringify({ recommendations, rawText: result.text.substring(0, 2000) }),
      },
    })
    await tx.umbrellaArc.update({
      where: { id: umbrellaArcId },
      data: { intelligenceScanLastRunAt: row.ranAt },
    })
    return row
  })

  return {
    scanId: scan.id,
    umbrellaArcId,
    ranAt: scan.ranAt,
    recommendations,
    limitedData: umbrella.totalAnalyses < 5,
    costUsd: result.costUsd,
  }
}

export async function getLatestRecommendations(umbrellaArcId: string): Promise<{
  scanId: string | null
  ranAt: Date | null
  recommendations: Recommendation[]
  limitedData: boolean
}> {
  const [latest, umbrella] = await Promise.all([
    prisma.umbrellaIntelligenceScan.findFirst({
      where: { umbrellaArcId },
      orderBy: { ranAt: 'desc' },
    }),
    prisma.umbrellaArc.findUnique({
      where: { id: umbrellaArcId },
      select: { totalAnalyses: true },
    }),
  ])

  if (!latest) {
    return {
      scanId: null,
      ranAt: null,
      recommendations: [],
      limitedData: (umbrella?.totalAnalyses ?? 0) < 5,
    }
  }

  let recommendations: Recommendation[] = []
  try {
    const parsed = JSON.parse(latest.rawOutput)
    if (Array.isArray(parsed.recommendations)) recommendations = parsed.recommendations
  } catch {
    // corrupted — treat as empty
  }

  return {
    scanId: latest.id,
    ranAt: latest.ranAt,
    recommendations,
    limitedData: (umbrella?.totalAnalyses ?? 0) < 5,
  }
}
