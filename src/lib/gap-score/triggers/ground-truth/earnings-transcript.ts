/**
 * T-GT11 — earnings call transcript availability.
 *
 * Polls DCF for newly-available transcripts, resolves ticker → TrackedEntity,
 * emits fires with severity 0.7 per Phase 1 addendum A1.4 T-GT11.
 * Also upserts EarningsSchedule for each seen transcript: confirmed=true
 * for this date; next projected = reportDate + 90 days (heuristic per
 * manifest A7). Used downstream by T-N2 quiet-period guard.
 *
 * Transcript body: 2000-char preview + filing URL stored in TriggerEvent
 * metadata per manifest A8. Full body fetched on-demand by Phase 2 Haiku.
 *
 * Direction: 0 (downstream LLM sentiment scoring determines).
 * Dedup: cursor on latest report_date seen; per-(entity, reportDate)
 * dedup via EarningsSchedule upsert.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import {
  fetchRecentTranscripts,
  fetchTranscript,
  type DcfTranscriptRef,
} from '@/lib/raw-signals/clients/dcf-client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'

const TRIGGER_ID = 'T-GT11'
const CURSOR_TYPE = 'dcf_latest_report_date'
const SEVERITY = 0.7
const PROJECTED_CADENCE_DAYS = 90
const TRANSCRIPT_PREVIEW_CHARS = 2000

export async function earningsTranscriptTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const apiKey = process.env.DCF_API_KEY
  if (!apiKey) {
    await writeMissingKeyHeartbeat(ctx.prisma, 'dcf', 'DCF_API_KEY')
    return []
  }

  // Cursor: fetch transcripts newer than the last one we processed
  const cursor = await readCursor(ctx.prisma)
  const outcome = await fetchRecentTranscripts(apiKey, cursor ?? undefined)
  if (!outcome.ok) {
    // One-shot failure — leave cursor alone, next scan retries
    return []
  }
  if (outcome.value.length === 0) return []

  // Resolve tickers to tracked entities in bulk
  const tickers = Array.from(new Set(outcome.value.map((r) => r.ticker)))
  const entities = await ctx.prisma.trackedEntity.findMany({
    where: { identifier: { in: tickers }, active: true },
    select: { id: true, identifier: true },
  })
  const entityByTicker = new Map(entities.map((e) => [e.identifier.toUpperCase(), e.id]))

  const fires: TriggerFireEvent[] = []
  let maxReportDate = cursor ?? ''

  for (const ref of outcome.value) {
    if (ref.reportDate > maxReportDate) maxReportDate = ref.reportDate
    const entityId = entityByTicker.get(ref.ticker.toUpperCase())
    if (!entityId) continue

    // Check if we've already fired T-GT11 for this (entity, reportDate)
    const existing = await ctx.prisma.triggerEvent.findFirst({
      where: {
        entityId,
        triggerType: TRIGGER_ID,
        firedAt: { gte: new Date(new Date(ref.reportDate).getTime() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    })
    if (existing) continue

    // Fetch full transcript for preview
    const transcriptOutcome = await fetchTranscript(ref.ticker, apiKey)
    const preview = transcriptOutcome.ok
      ? transcriptOutcome.value.content.slice(0, TRANSCRIPT_PREVIEW_CHARS)
      : ''

    // Upsert EarningsSchedule: this report confirmed + next projected
    await upsertEarningsSchedule(ctx.prisma, entityId, ref)

    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity: SEVERITY,
      metadata: {
        ticker: ref.ticker,
        quarter: ref.quarter,
        year: ref.year,
        report_date: ref.reportDate,
        transcript_preview: preview,
        transcript_url: `https://discountingcashflows.com/company/${ref.ticker}/transcripts/${ref.year}/Q${ref.quarter}/`,
        direction: 0,
      },
    })
  }

  // Advance cursor to max report_date seen
  if (maxReportDate && maxReportDate !== cursor) {
    await writeCursor(ctx.prisma, maxReportDate)
  }

  return fires
}

async function readCursor(prisma: TriggerContext['prisma']): Promise<string | null> {
  const row = await prisma.triggerCursor.findUnique({
    where: { triggerId_cursorType: { triggerId: TRIGGER_ID, cursorType: CURSOR_TYPE } },
    select: { cursorValue: true },
  })
  return row?.cursorValue ?? null
}

async function writeCursor(prisma: TriggerContext['prisma'], cursorValue: string): Promise<void> {
  await prisma.triggerCursor.upsert({
    where: { triggerId_cursorType: { triggerId: TRIGGER_ID, cursorType: CURSOR_TYPE } },
    create: { triggerId: TRIGGER_ID, cursorType: CURSOR_TYPE, cursorValue },
    update: { cursorValue },
  })
}

/**
 * Upsert:
 *   - this report: confirmed=true (actual date known)
 *   - next projected: reportDate + 90 days, confirmed=false
 */
async function upsertEarningsSchedule(
  prisma: TriggerContext['prisma'],
  entityId: string,
  ref: DcfTranscriptRef,
): Promise<void> {
  const reportDate = new Date(`${ref.reportDate}T00:00:00Z`)

  // Confirm this report
  await prisma.earningsSchedule.upsert({
    where: { entityId_reportDate: { entityId, reportDate } },
    create: {
      entityId,
      ticker: ref.ticker,
      reportDate,
      confirmed: true,
    },
    update: { confirmed: true },
  })

  // Project next report +90 days (manifest A7 heuristic)
  const nextDate = new Date(reportDate.getTime() + PROJECTED_CADENCE_DAYS * 24 * 60 * 60 * 1000)
  await prisma.earningsSchedule.upsert({
    where: { entityId_reportDate: { entityId, reportDate: nextDate } },
    create: {
      entityId,
      ticker: ref.ticker,
      reportDate: nextDate,
      confirmed: false,
    },
    update: {}, // don't overwrite if already there (e.g., a later transcript confirmed it)
  })
}
