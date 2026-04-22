/**
 * T-GT1 — SEC Form 4 large insider transaction.
 *
 * Polls the EDGAR full-text search for Form 4 filings since the cursor,
 * resolves each filing's issuer (via CIK / ticker) to a TrackedEntity,
 * and fires when any severity threshold is met:
 *
 *   Fire criteria (Phase 1 addendum A1.4 T-GT1):
 *     - transaction_value_usd >= 1_000_000, OR
 *     - transaction_size_pct_of_holdings >= 0.10, OR
 *     - ≥2 insiders at same issuer filing same-direction trades within 48h
 *
 *   Severity: log-scaled by dollar amount ($1M=0.3, $10M=0.6, $100M+=1.0)
 *   Direction: buy = +1, sell = -1
 *
 * Transaction value parsing note: EDGAR full-text search returns metadata
 * only. Actual transaction amounts live inside the Form 4 XML document at
 * the accession number's archive path. For Phase 1c.2a we use the count
 * heuristic (≥2 same-issuer filings within 48h) which is satisfiable with
 * just metadata. Dollar-thresholded firing remains a follow-up once the
 * XML parse layer lands. Unresolved hits still log to CostLog either way.
 *
 * Metadata payload captures the full filing hit so Gap Score consumers
 * downstream can inspect each fire without refetching EDGAR — manifest A1
 * decision (metadata-only, no RawSignalLayer writes from triggers).
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { pollRecentFilings } from '@/lib/raw-signals/clients/sec-edgar-client'
import {
  resolveFilings,
  logUnmatchedFilings,
  type ResolvedFiling,
} from './sec-entity-resolver'
import {
  readFileDateCursor,
  writeFileDateCursor,
  maxFileDate,
} from './sec-cursor'

const TRIGGER_ID = 'T-GT1'
const MAX_HITS = 100
const CLUSTER_WINDOW_HOURS = 48
const CLUSTER_MIN_INSIDERS = 2

/**
 * Map a $-amount (USD) to severity per the Phase 1 addendum ladder.
 * Currently unused — Form 4 XML parse lands in a follow-up. Kept here
 * so the ladder is colocated with the trigger that owns it.
 */
export function form4SeverityFromUsd(usd: number): number {
  if (usd <= 0) return 0
  // Log-scaled: $1M → 0.3, $10M → 0.6, $100M+ → 1.0
  // Linear in log10: 6→0.3, 7→0.6, 8+→1.0
  const log = Math.log10(usd)
  if (log < 6) return 0
  if (log >= 8) return 1.0
  if (log < 7) return 0.3 + (log - 6) * 0.3
  return 0.6 + (log - 7) * 0.4
}

/**
 * Group resolved filings by issuer, then detect same-direction clusters
 * of ≥2 insiders within CLUSTER_WINDOW_HOURS. Form 4 hits from EDGAR
 * don't carry direction metadata (needs XML parse), so for the metadata-
 * only heuristic we treat any same-issuer cluster as a fire.
 */
function detectInsiderClusters(resolved: ResolvedFiling[]): Map<string, ResolvedFiling[]> {
  const byEntity = new Map<string, ResolvedFiling[]>()
  for (const r of resolved) {
    const existing = byEntity.get(r.entityId) ?? []
    existing.push(r)
    byEntity.set(r.entityId, existing)
  }

  const clusters = new Map<string, ResolvedFiling[]>()
  for (const [entityId, filings] of byEntity.entries()) {
    if (filings.length < CLUSTER_MIN_INSIDERS) continue
    // Sort by filing date, check if any window of CLUSTER_WINDOW_HOURS
    // contains ≥2 distinct filings.
    const sorted = [...filings].sort((a, b) => a.hit.filedAt.localeCompare(b.hit.filedAt))
    for (let i = 0; i < sorted.length - 1; i++) {
      const start = new Date(sorted[i].hit.filedAt)
      const end = new Date(sorted[i + 1].hit.filedAt)
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue
      const deltaHrs = (end.getTime() - start.getTime()) / (60 * 60 * 1000)
      if (deltaHrs <= CLUSTER_WINDOW_HOURS) {
        clusters.set(entityId, sorted)
        break
      }
    }
  }
  return clusters
}

export async function secForm4Trigger(ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  const cursor = await readFileDateCursor(ctx.prisma, TRIGGER_ID)

  const outcome = await pollRecentFilings({
    forms: ['4', '4/A'],
    sinceCursor: cursor,
    until: ctx.now,
    maxHits: MAX_HITS,
  })

  if (!outcome.ok) {
    // Cursor stays put — next scan retries the same window. Dispatcher
    // cost-logs the error via its own catch block.
    throw new Error(`T-GT1 EDGAR poll failed: ${outcome.errorType}`)
  }

  if (outcome.hits.length === 0) {
    return []
  }

  // Resolve to tracked entities; unmatched → audit log.
  const { resolved, unresolved } = await resolveFilings(ctx.prisma, outcome.hits)
  await logUnmatchedFilings(ctx.prisma, TRIGGER_ID, unresolved)

  const clusters = detectInsiderClusters(resolved)
  const fires: TriggerFireEvent[] = []

  for (const [entityId, clusterFilings] of clusters.entries()) {
    // Severity: base 0.5 for the cluster-of-insiders heuristic (between
    // $1M and $10M in the log ladder), bumped to 0.7 if ≥3 filings.
    const severity = clusterFilings.length >= 3 ? 0.7 : 0.5
    fires.push({
      entityId,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity,
      metadata: {
        criterion: 'insider_cluster',
        cluster_window_hours: CLUSTER_WINDOW_HOURS,
        filing_count: clusterFilings.length,
        // Direction unknown until XML parse — emit 0 (ambiguous).
        direction: 0,
        filings: clusterFilings.map((f) => ({
          accessionNumber: f.hit.accessionNumber,
          formType: f.hit.formType,
          filedAt: f.hit.filedAt,
          entityIdentifier: f.entityIdentifier,
          resolvedBy: f.resolvedBy,
          url: f.hit.displayNames[0] ?? null,
        })),
      },
    })
  }

  // Advance cursor to max filedAt seen, even when no fires — we've
  // still processed these hits.
  const nextCursor = maxFileDate(outcome.hits)
  if (nextCursor) {
    await writeFileDateCursor(ctx.prisma, TRIGGER_ID, nextCursor)
  }

  return fires
}
