/**
 * Per-queue job data + result type contracts.
 *
 * Phase 1a ships placeholder shapes — enough for the typed factories and the
 * no-op worker host to compile with strict TypeScript. Phase 1b processors
 * will flesh these out; when they do, update this file AND the corresponding
 * tests in src/__tests__/queue-*.test.ts.
 *
 * Keep these minimal. The queue layer should not leak domain logic — that's
 * the processor's job. These interfaces describe the smallest payload needed
 * to fetch context from the DB on the processor side.
 */

import type { QueueName } from './names'
import { QUEUE_NAMES } from './names'

// ── Gap Score ────────────────────────────────────────────────────────────

export interface GapScoreFeaturedBaselineJob {
  /** TrackedEntity.id of the featured entity to rescore. */
  entityId: string
  /** Wall-clock time the scheduler decided this rescan was due. */
  scheduledFor: string // ISO 8601
}

export interface GapScoreCandidateComputeJob {
  /** TrackedEntity.id of the candidate. */
  entityId: string
  /** TriggerEvent.ids that promoted this entity to candidate status. */
  triggerEventIds: string[]
  /** Candidate-generator run id for correlation. */
  candidateRunId: string
}

export interface GapScoreBackfillJob {
  entityId: string
  /** Point-in-time timestamp to reconstruct Gap Score as of. */
  asOfTimestamp: string // ISO 8601
  /** Optional case-study id this backfill is feeding. */
  caseStudyId?: string
}

// ── Paper Trading (Phase 1b+ — scaffolded here for type stability) ───────

export interface PaperTradingStrategyGenerateJob {
  /** GapScore.id above threshold that triggered this strategy request. */
  gapScoreId: string
}

export interface PaperTradingExecuteJob {
  /** StrategyOutput.id from the strategy-generate step. */
  strategyOutputId: string
}

export interface PaperTradingMonitorPositionsJob {
  /** Cron tick id — populated by the repeatable job scheduler. */
  tickId: string
}

export interface PaperTradingAggregatePerformanceJob {
  /** Which rolling window to recompute. */
  periodDays: 7 | 30 | 90 | null // null = all-time
}

// ── Result shapes (placeholder for Phase 1a) ─────────────────────────────

export interface PlaceholderJobResult {
  placeholder: true
  processedAt: string // ISO 8601
}

// ── Mapping (QueueName → JobData) ────────────────────────────────────────
// TypeScript utility: consumers of the queue API can write
// `getQueue<JobDataFor<'gap-score:candidate-compute'>>('gap-score:candidate-compute')`
// and receive a typed Queue. Phase 1b when processors exist will lean on this.

export type JobDataFor<N extends QueueName> = N extends typeof QUEUE_NAMES.GAP_SCORE_FEATURED_BASELINE
  ? GapScoreFeaturedBaselineJob
  : N extends typeof QUEUE_NAMES.GAP_SCORE_CANDIDATE_COMPUTE
    ? GapScoreCandidateComputeJob
    : N extends typeof QUEUE_NAMES.GAP_SCORE_BACKFILL
      ? GapScoreBackfillJob
      : N extends typeof QUEUE_NAMES.PAPER_TRADING_STRATEGY_GENERATE
        ? PaperTradingStrategyGenerateJob
        : N extends typeof QUEUE_NAMES.PAPER_TRADING_EXECUTE
          ? PaperTradingExecuteJob
          : N extends typeof QUEUE_NAMES.PAPER_TRADING_MONITOR_POSITIONS
            ? PaperTradingMonitorPositionsJob
            : N extends typeof QUEUE_NAMES.PAPER_TRADING_AGGREGATE_PERFORMANCE
              ? PaperTradingAggregatePerformanceJob
              : never
