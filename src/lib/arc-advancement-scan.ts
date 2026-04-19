import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { prisma } from '@/lib/db'

/**
 * Arc Advancement Scan (Session 3 Step 4)
 *
 * For each active core story arc, a lightweight Haiku call (~$0.01) that decides
 * whether the story has materially advanced since its most recent analysis.
 * Medium- or high-confidence detections surface as notification banners on
 * /admin/signals/arc-queue.
 *
 * MIN_SIGNAL: advancement detection confidence below medium MUST NEVER surface
 *             a UI notification. Low-confidence scans are logged for analysis
 *             but silently discarded from the admin-facing UI.
 */

export type ConfidenceLevel = 'low' | 'medium' | 'high'

export interface ArcAdvancementResult {
  scanId: string
  storyArcId: string
  umbrellaArcId: string
  advancementDetected: boolean
  confidenceLevel: ConfidenceLevel
  rationale: string | null
  scannedAt: Date
  shouldNotifyUI: boolean     // true only when detected AND confidence is medium/high
  costUsd: number
}

const SYSTEM_PROMPT = `You are an arc advancement detector for Overcurrent, a news-coverage analysis platform.

A "story arc" is a bounded event being re-analyzed across phases (first_wave → development → consolidation → tail). Between phases, the analyst wants to know: has this story materially advanced since the last analysis? "Materially" means new developments that would change the analytical findings — NOT just ongoing coverage of the same facts.

YOU WILL RECEIVE: arc label, parent umbrella name, signalCategory, most recent analysis headline, and the hours elapsed since that most recent analysis.

YOU MUST RETURN:
  - advancementDetected: true only when there is a specific reason to believe meaningful change has occurred
  - confidenceLevel: "low" | "medium" | "high"
     - high: you have concrete reasoning pointing to specific new developments
     - medium: suggestive patterns but not verified change
     - low: no concrete signal — default when uncertain
  - rationale: ONE sentence explaining your decision. If advancementDetected=false, still include a brief rationale.

DISCIPLINE:
  - Default to LOW confidence when uncertain. Overcurrent's users see notification banners only for medium+ confidence detections.
  - Do NOT fabricate news events. If you don't have concrete reason to believe something happened, say so and return low confidence.
  - Do NOT repeat the arc label back as "advancement" — genuine advancement is a NEW development, not the same story.

CRITICAL: Response must be ONLY a valid JSON object. No markdown, no prose.

Response shape:
{
  "advancementDetected": true | false,
  "confidenceLevel": "low" | "medium" | "high",
  "rationale": "one sentence"
}`

/**
 * Run advancement scan for a single story arc.
 * Persists to ArcAdvancementScan regardless of confidence level
 * (low-confidence scans are logged but silently discarded from UI).
 */
export async function runArcAdvancementScan(
  storyArcId: string,
): Promise<ArcAdvancementResult> {
  const arc = await prisma.story.findUnique({
    where: { id: storyArcId },
    select: {
      id: true,
      umbrellaArcId: true,
      arcLabel: true,
      headline: true,
      createdAt: true,
      analysisType: true,
      arcImportance: true,
      umbrellaArc: {
        select: {
          id: true,
          name: true,
          signalCategory: true,
        },
      },
      storyCluster: {
        select: {
          id: true,
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, headline: true, createdAt: true },
          },
        },
      },
    },
  })
  if (!arc) throw new Error(`Story arc not found: ${storyArcId}`)
  if (!arc.umbrellaArcId) throw new Error(`Story is not filed under an umbrella: ${storyArcId}`)
  if (arc.analysisType !== 'new_arc') throw new Error(`Story is not a new_arc: ${storyArcId}`)
  if (arc.arcImportance !== 'core') throw new Error(`Advancement scans only run on core arcs`)

  const mostRecent = arc.storyCluster?.analyses?.[0]
  const lastHeadline = mostRecent?.headline ?? arc.headline
  const lastAnalyzedAt = mostRecent?.createdAt ?? arc.createdAt
  const hoursElapsed = (Date.now() - new Date(lastAnalyzedAt).getTime()) / (60 * 60 * 1000)

  const userPrompt = `ARC LABEL: ${arc.arcLabel ?? arc.headline}
PARENT UMBRELLA: ${arc.umbrellaArc?.name ?? '(unknown)'}
SIGNAL CATEGORY: ${arc.umbrellaArc?.signalCategory ?? '(unknown)'}
MOST RECENT ANALYSIS HEADLINE: ${lastHeadline}
HOURS SINCE LAST ANALYSIS: ${hoursElapsed.toFixed(1)}

Has this story materially advanced? JSON only.`

  const result = await callClaude({
    model: HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'arc_advancement_scan',
    maxTokens: 512,
  })

  let advancementDetected = false
  let confidenceLevel: ConfidenceLevel = 'low'
  let rationale: string | null = null

  try {
    const parsed = parseJSON<{
      advancementDetected?: boolean
      confidenceLevel?: string
      rationale?: string
    }>(result.text)
    advancementDetected = parsed.advancementDetected === true
    const lvl = parsed.confidenceLevel?.toLowerCase() ?? 'low'
    confidenceLevel = lvl === 'high' ? 'high' : lvl === 'medium' ? 'medium' : 'low'
    rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() || null : null
  } catch (err) {
    console.warn('[arc-advancement-scan] parse failed — defaulting to low confidence', err)
  }

  // Persist regardless — low-confidence scans provide data for future tuning
  const scan = await prisma.arcAdvancementScan.create({
    data: {
      storyArcId,
      umbrellaArcId: arc.umbrellaArcId,
      advancementDetected,
      confidenceLevel,
      rationale,
      triggeredAnalysis: false,
    },
  })

  // ── PHASE 2 (Session 4): IMMUTABLE TIMELINE HOOK ──────────────────────
  // Fire-and-forget ArcTimelineEvent write. Every scan lands on the
  // cluster's immutable timeline (including low-confidence — it's a
  // permanent record of everything the system looked at). Never blocks.
  const clusterIdForTimeline = arc.storyCluster?.id
  if (clusterIdForTimeline) {
    ;(async () => {
      try {
        const { writeAdvancementDetectionEvent } = await import('@/lib/publish-hooks/arc-timeline')
        await writeAdvancementDetectionEvent({
          scanId: scan.id,
          storyClusterId: clusterIdForTimeline,
          storyArcId,
          umbrellaArcId: arc.umbrellaArcId,
          confidenceLevel,
          rationale,
          advancementDetected,
        })
      } catch (err) {
        console.warn(
          '[arc-advancement-scan] Timeline hook failed (non-blocking):',
          err instanceof Error ? err.message : err,
        )
      }
    })()
  }

  const shouldNotifyUI =
    advancementDetected && (confidenceLevel === 'medium' || confidenceLevel === 'high')

  return {
    scanId: scan.id,
    storyArcId,
    umbrellaArcId: arc.umbrellaArcId,
    advancementDetected,
    confidenceLevel,
    rationale,
    scannedAt: scan.scannedAt,
    shouldNotifyUI,
    costUsd: result.costUsd,
  }
}

/**
 * Return unresolved advancement detections ready to display as UI banners.
 * Filters STRICTLY: detected=true, confidence in (medium, high), not yet triggered.
 * Most-recent scan wins per arc (we don't want to spam banners).
 */
export async function getUnresolvedAdvancements(): Promise<Array<{
  scanId: string
  storyArcId: string
  umbrellaArcId: string
  arcLabel: string | null
  umbrellaName: string
  confidenceLevel: ConfidenceLevel
  rationale: string | null
  scannedAt: Date
  searchQuery: string
  arcPhaseAtCreation: string | null
}>> {
  // Get all medium+ detected scans that haven't been triggered
  const scans = await prisma.arcAdvancementScan.findMany({
    where: {
      advancementDetected: true,
      confidenceLevel: { in: ['medium', 'high'] },
      triggeredAnalysis: false,
    },
    orderBy: { scannedAt: 'desc' },
    include: {
      storyArc: {
        select: {
          id: true,
          arcLabel: true,
          headline: true,
          searchQuery: true,
          arcPhaseAtCreation: true,
        },
      },
      umbrellaArc: {
        select: { id: true, name: true },
      },
    },
  })

  // Dedupe by storyArcId — only the most recent scan per arc is shown
  const seen = new Set<string>()
  const deduped = scans.filter(s => {
    if (seen.has(s.storyArcId)) return false
    seen.add(s.storyArcId)
    return true
  })

  return deduped.map(s => ({
    scanId: s.id,
    storyArcId: s.storyArcId,
    umbrellaArcId: s.umbrellaArcId,
    arcLabel: s.storyArc.arcLabel ?? s.storyArc.headline,
    umbrellaName: s.umbrellaArc.name,
    confidenceLevel: s.confidenceLevel as ConfidenceLevel,
    rationale: s.rationale,
    scannedAt: s.scannedAt,
    searchQuery: s.storyArc.searchQuery,
    arcPhaseAtCreation: s.storyArc.arcPhaseAtCreation,
  }))
}
