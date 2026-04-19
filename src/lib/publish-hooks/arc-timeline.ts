/**
 * Immutable arc timeline writer (System L).
 *
 * Single append-only sink for every event that touches a story cluster.
 * Nothing is ever updated or deleted — corrections are new rows, not edits.
 *
 * streamType tags every event with its source stream:
 *   narrative       — Stream 1: formal media coverage
 *   ground_truth    — Stream 2: physical/financial/legal raw signals
 *   psychological   — Stream 3: unfiltered social signals
 *
 * Helpers below cover the event types that Phase 2 can detect automatically.
 * Later phases add more (source_surge, outlet_tier_entry, framing_shift,
 * correction, social_velocity_spike).
 */

import { prisma } from '@/lib/db'

type StreamType = 'narrative' | 'ground_truth' | 'psychological'
type EventType =
  | 'analysis_run'
  | 'raw_signal'
  | 'social_signal'
  | 'source_surge'
  | 'outlet_tier_entry'
  | 'framing_shift'
  | 'advancement_detection'
  | 'correction'
  | 'social_velocity_spike'

interface WriteEventInput {
  storyClusterId: string
  umbrellaArcId?: string | null
  eventType: EventType
  eventTimestamp: Date
  eventData: Record<string, unknown>
  streamType: StreamType
  isWildFinding?: boolean
  wildFindingPercentile?: number | null
  isCorrectionEvent?: boolean
  correctionDescription?: string | null
  correctionImpact?: string | null
  isPublic?: boolean
}

/**
 * Low-level writer. Never throws — swallows and logs on failure. Callers can
 * fire-and-forget.
 */
export async function writeArcTimelineEvent(input: WriteEventInput): Promise<void> {
  try {
    await prisma.arcTimelineEvent.create({
      data: {
        storyClusterId: input.storyClusterId,
        umbrellaArcId: input.umbrellaArcId ?? null,
        eventType: input.eventType,
        eventTimestamp: input.eventTimestamp,
        eventData: input.eventData as object,
        streamType: input.streamType,
        isWildFinding: input.isWildFinding ?? false,
        wildFindingPercentile: input.wildFindingPercentile ?? null,
        isCorrectionEvent: input.isCorrectionEvent ?? false,
        correctionDescription: input.correctionDescription ?? null,
        correctionImpact: input.correctionImpact ?? null,
        isPublic: input.isPublic ?? true,
      },
    })
  } catch (err) {
    console.warn(
      `[arc-timeline] writeArcTimelineEvent failed (${input.eventType}):`,
      err instanceof Error ? err.message : err,
    )
  }
}

// ── Helper: analysis_run (narrative stream) ─────────────────────────────
// Fires at the end of every pipeline run that lands in a cluster.
export async function writeAnalysisRunEvent(params: {
  storyId: string
  storyClusterId: string
  umbrellaArcId?: string | null
  headline: string
  sourceCount: number
  signalCategory: string | null
  storyPhase: string | null
  analysisType: string | null
  versionNumber?: number
}): Promise<void> {
  await writeArcTimelineEvent({
    storyClusterId: params.storyClusterId,
    umbrellaArcId: params.umbrellaArcId,
    eventType: 'analysis_run',
    eventTimestamp: new Date(),
    eventData: {
      storyId: params.storyId,
      headline: params.headline,
      sourceCount: params.sourceCount,
      signalCategory: params.signalCategory,
      storyPhase: params.storyPhase,
      analysisType: params.analysisType,
      versionNumber: params.versionNumber ?? 1,
    },
    streamType: 'narrative',
    isPublic: true,
  })
}

// ── Helper: raw_signal (ground_truth stream) ────────────────────────────
// Fires after every successful RawSignalLayer insert.
export async function writeRawSignalEvent(params: {
  rawSignalLayerId: string
  storyClusterId: string
  umbrellaArcId?: string | null
  signalType: string
  signalSource: string
  divergenceFlag: boolean
  confidenceLevel: 'low' | 'medium' | 'high'
  haikuSummary: string
  captureDate: Date
}): Promise<void> {
  await writeArcTimelineEvent({
    storyClusterId: params.storyClusterId,
    umbrellaArcId: params.umbrellaArcId,
    eventType: 'raw_signal',
    eventTimestamp: params.captureDate,
    eventData: {
      rawSignalLayerId: params.rawSignalLayerId,
      signalType: params.signalType,
      signalSource: params.signalSource,
      divergenceFlag: params.divergenceFlag,
      confidenceLevel: params.confidenceLevel,
      summary: params.haikuSummary,
    },
    streamType: 'ground_truth',
    // Raw signals are admin-only until reviewed — keep timeline row private by default.
    isPublic: false,
  })
}

// ── Helper: advancement_detection (narrative stream — signal about coverage) ────
// Fires every time an ArcAdvancementScan lands a medium/high confidence hit.
export async function writeAdvancementDetectionEvent(params: {
  scanId: string
  storyClusterId: string
  storyArcId: string
  umbrellaArcId?: string | null
  confidenceLevel: 'low' | 'medium' | 'high'
  rationale: string | null
  advancementDetected: boolean
}): Promise<void> {
  await writeArcTimelineEvent({
    storyClusterId: params.storyClusterId,
    umbrellaArcId: params.umbrellaArcId,
    eventType: 'advancement_detection',
    eventTimestamp: new Date(),
    eventData: {
      scanId: params.scanId,
      storyArcId: params.storyArcId,
      confidenceLevel: params.confidenceLevel,
      rationale: params.rationale,
      advancementDetected: params.advancementDetected,
    },
    streamType: 'narrative',
    // Admin-only — surfaces on arc queue UI, not public.
    isPublic: false,
  })
}

// ── Helper: social_signal (psychological stream) — Phase 9 wiring ─────────
// Skeleton now; callers land in Phase 9.
export async function writeSocialSignalEvent(params: {
  socialSignalId: string
  storyClusterId: string
  umbrellaArcId?: string | null
  platform: string
  divergesFromNarrative: boolean
  engagementVelocity: number | null
  haikuSummary: string
  postDate: Date
}): Promise<void> {
  await writeArcTimelineEvent({
    storyClusterId: params.storyClusterId,
    umbrellaArcId: params.umbrellaArcId,
    eventType: 'social_signal',
    eventTimestamp: params.postDate,
    eventData: {
      socialSignalId: params.socialSignalId,
      platform: params.platform,
      divergesFromNarrative: params.divergesFromNarrative,
      engagementVelocity: params.engagementVelocity,
      summary: params.haikuSummary,
    },
    streamType: 'psychological',
    isPublic: false,
  })
}

// ── Helper: correction — admin-driven, admin UI writes these ─────────────
// Skeleton; the admin correction UI lands in Phase 18.
export async function writeCorrectionEvent(params: {
  storyClusterId: string
  umbrellaArcId?: string | null
  description: string
  impact: string
  reviewedBy: string
}): Promise<void> {
  await writeArcTimelineEvent({
    storyClusterId: params.storyClusterId,
    umbrellaArcId: params.umbrellaArcId,
    eventType: 'correction',
    eventTimestamp: new Date(),
    eventData: {
      reviewedBy: params.reviewedBy,
    },
    streamType: 'narrative',
    isCorrectionEvent: true,
    correctionDescription: params.description,
    correctionImpact: params.impact,
    // Corrections are public by design — transparency is the product.
    isPublic: true,
  })
}
