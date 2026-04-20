/**
 * Case-study auto-create hooks. Three write paths feed the CaseStudyEntry
 * archive that powers the admin browse page and (eventually) the enterprise-
 * facing evidence library:
 *
 *   1. createCaseStudyFromQualityKill      \u2014 quality review verdict = 'kill'
 *   2. createCaseStudyFromQualityEdits     \u2014 quality review verdict = 'approved_with_edits'
 *   3. createCaseStudyFromRawSignalReview  \u2014 admin marks RawSignalLayer reviewed with notes
 *
 * Common rules:
 *   - All three set isPublishable=false on create. Admin must explicitly publish.
 *   - All three are idempotent: same headline + cluster \u2192 skip the insert.
 *   - All three return null when required context is missing (no cluster, no
 *     edits to document, raw signal not yet reviewed).
 *   - Dependency-injected writer + existsCheck for tests; defaults use Prisma.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaseStudyEntryCreateData {
  rawSignalLayerId: string | null
  storyClusterId: string
  umbrellaArcId: string | null
  signalType: string
  headline: string
  fullDescription: string
  storyPhaseAtDetection: string
  divergenceType: string
  isPublishable: boolean
}

export type CaseStudyWriter = (data: CaseStudyEntryCreateData) => Promise<{ id: string } & CaseStudyEntryCreateData>

export type CaseStudyExistsCheck = (storyClusterId: string, headline: string) => Promise<boolean>

export interface QualityReviewKillContext {
  storyId: string
  storyHeadline: string
  storyPhase: string | null
  storyClusterId: string | null
  umbrellaArcId: string | null
  killReason: string
  pattern: string | null
}

export interface QualityReviewEditsContext {
  storyId: string
  storyHeadline: string
  storyPhase: string | null
  storyClusterId: string | null
  umbrellaArcId: string | null
  pattern: string | null
  suggestedEdits: string | null
}

export interface RawSignalReviewContext {
  rawSignalLayerId: string
  storyClusterId: string | null
  umbrellaArcId: string | null
  signalType: string
  signalSource: string
  haikuSummary: string
  divergenceFlag: boolean
  divergenceDescription: string | null
  adminNotes: string | null
  reviewedByAdmin: boolean
}

export interface HookOptions {
  writer?: CaseStudyWriter
  exists?: CaseStudyExistsCheck
}

// ---------------------------------------------------------------------------
// Default writer + exists check (Prisma-backed). Lazy-imported so unit tests
// can inject stubs without forcing Prisma into the test process.
// ---------------------------------------------------------------------------

async function defaultWriter(data: CaseStudyEntryCreateData) {
  const { prisma } = await import('@/lib/db')
  return prisma.caseStudyEntry.create({ data })
}

async function defaultExists(storyClusterId: string, headline: string): Promise<boolean> {
  const { prisma } = await import('@/lib/db')
  const found = await prisma.caseStudyEntry.findFirst({
    where: { storyClusterId, headline },
    select: { id: true },
  })
  return found !== null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEADLINE_MAX = 200

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '\u2026'
}

function firstSentence(text: string): string {
  const trimmed = (text ?? '').trim()
  const m = trimmed.match(/^[^.!?]*[.!?]/)
  return (m ? m[0] : trimmed).trim()
}

function defaultPhase(phase: string | null | undefined): string {
  return phase && phase.length > 0 ? phase : 'consolidation'
}

// ---------------------------------------------------------------------------
// Hook 1: Quality review kill
// ---------------------------------------------------------------------------

export async function createCaseStudyFromQualityKill(
  ctx: QualityReviewKillContext,
  opts: HookOptions = {},
): Promise<{ id: string } | null> {
  if (!ctx.storyClusterId) return null

  const writer = opts.writer ?? defaultWriter
  const exists = opts.exists ?? defaultExists

  const reasonHead = firstSentence(ctx.killReason)
  const headline = truncate(
    `Quality review killed: ${ctx.storyHeadline} \u2014 ${reasonHead}`,
    HEADLINE_MAX,
  )

  if (await exists(ctx.storyClusterId, headline)) return null

  const fullDescription = `## Quality Review Kill Decision

The Overcurrent quality-review agent killed this analysis at the ${defaultPhase(ctx.storyPhase)} phase. Auto-archived; never surfaced on the public site. This case study documents the kill for threshold-tuning and editorial-pattern recognition.

## Story

${ctx.storyHeadline}

(Story ID: ${ctx.storyId})

## Pattern That Was Killed

${ctx.pattern ?? '(no Pattern produced)'}

## Kill Reason

${ctx.killReason}

## What Comes Next

Admin can either:

- Revise the Pattern + supporting claims and resubmit (\`runQualityReview(storyId, { force: true })\`)
- Mark this case study \`isPublishable=true\` if the kill itself documents an editorial pattern worth sharing externally
- Update the parent StoryCluster.adminNotes with a standing rule that prevents this kill mode from recurring

## Why This Was Auto-Archived

Per System E (quality review): kill verdicts auto-archive the Story (status='archived') so contested findings never surface on the public review queue. Kills land here for threshold tuning and pattern documentation.`

  const created = await writer({
    rawSignalLayerId: null,
    storyClusterId: ctx.storyClusterId,
    umbrellaArcId: ctx.umbrellaArcId,
    signalType: 'editorial_kill',
    headline,
    fullDescription,
    storyPhaseAtDetection: defaultPhase(ctx.storyPhase),
    divergenceType: 'narrative_contradicts_raw',
    isPublishable: false,
  })
  return { id: created.id }
}

// ---------------------------------------------------------------------------
// Hook 2: Quality review approved_with_edits
// ---------------------------------------------------------------------------

export async function createCaseStudyFromQualityEdits(
  ctx: QualityReviewEditsContext,
  opts: HookOptions = {},
): Promise<{ id: string } | null> {
  if (!ctx.storyClusterId) return null
  if (!ctx.suggestedEdits || ctx.suggestedEdits.trim().length === 0) return null

  const writer = opts.writer ?? defaultWriter
  const exists = opts.exists ?? defaultExists

  const headline = truncate(
    `Edits required: ${ctx.storyHeadline}`,
    HEADLINE_MAX,
  )

  if (await exists(ctx.storyClusterId, headline)) return null

  const fullDescription = `## Quality Review Edits Required

The Overcurrent quality-review agent approved this analysis subject to specific edits. The story was not killed \u2014 the editorial finding was sound \u2014 but the agent identified concrete corrections that should land before publication. This case study documents the edits for editorial-pattern recognition and tuning.

## Story

${ctx.storyHeadline}

(Story ID: ${ctx.storyId})

## Pattern

${ctx.pattern ?? '(no Pattern produced)'}

## Suggested Edits

${ctx.suggestedEdits}

## What Comes Next

Admin can either:

- Apply the edits and publish the story
- Mark this case study \`isPublishable=true\` if the edits themselves document an editorial pattern worth sharing externally
- Update the parent StoryCluster.adminNotes if the edits reflect a recurring correction mode`

  const created = await writer({
    rawSignalLayerId: null,
    storyClusterId: ctx.storyClusterId,
    umbrellaArcId: ctx.umbrellaArcId,
    signalType: 'editorial_correction',
    headline,
    fullDescription,
    storyPhaseAtDetection: defaultPhase(ctx.storyPhase),
    divergenceType: 'narrative_omits_raw',
    isPublishable: false,
  })
  return { id: created.id }
}

// ---------------------------------------------------------------------------
// Hook 3: RawSignalLayer admin review
// ---------------------------------------------------------------------------

export async function createCaseStudyFromRawSignalReview(
  ctx: RawSignalReviewContext,
  opts: HookOptions = {},
): Promise<{ id: string } | null> {
  if (!ctx.storyClusterId) return null
  if (!ctx.reviewedByAdmin) return null
  if (!ctx.adminNotes || ctx.adminNotes.trim().length === 0) return null

  const writer = opts.writer ?? defaultWriter
  const exists = opts.exists ?? defaultExists

  const headline = truncate(
    `Raw signal: ${ctx.haikuSummary}`,
    HEADLINE_MAX,
  )

  if (await exists(ctx.storyClusterId, headline)) return null

  const divergenceType = ctx.divergenceFlag
    ? 'narrative_contradicts_raw'
    : 'raw_corroborates_narrative'

  const fullDescription = `## Raw Signal Reviewed

A raw signal from the Overcurrent ground-truth layer has been reviewed by an admin and marked as evidence-worthy. Source: \`${ctx.signalType}\` via \`${ctx.signalSource}\`. Raw-signal layer ID: \`${ctx.rawSignalLayerId}\`.

## Haiku Summary

${ctx.haikuSummary}

## Divergence

**Flag:** ${ctx.divergenceFlag ? 'TRUE \u2014 raw signal contradicts the dominant narrative' : 'FALSE \u2014 raw signal corroborates the dominant narrative'}

${ctx.divergenceDescription ? `**Description:** ${ctx.divergenceDescription}` : '_(no divergence description provided)_'}

## Admin Notes

${ctx.adminNotes}

## What Comes Next

Admin can mark this case study \`isPublishable=true\` if the finding is clean enough to share externally. Otherwise it remains in the internal evidence library.`

  const created = await writer({
    rawSignalLayerId: ctx.rawSignalLayerId,
    storyClusterId: ctx.storyClusterId,
    umbrellaArcId: ctx.umbrellaArcId,
    signalType: ctx.signalType,
    headline,
    fullDescription,
    storyPhaseAtDetection: 'consolidation',
    divergenceType,
    isPublishable: false,
  })
  return { id: created.id }
}
