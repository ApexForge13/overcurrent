/**
 * Single source of truth for BullMQ queue names.
 *
 * Naming convention (enforced by queue-names.test.ts):
 *   - All values start with "gap-score-" or "paper-trading-" (domain prefix).
 *   - Dashes only; NO colons. BullMQ reserves `:` as the internal Redis key
 *     separator and rejects queue names containing one ("Queue name cannot
 *     contain :"). The v2 master prompt and Phase 11 spec use colon-style
 *     names in prose (gap-score:candidate-compute); we translate to dashes
 *     at the code boundary. Environment isolation still uses colons in the
 *     prefix (overcurrent:prod:) — that's fine because the prefix is applied
 *     to the Redis key, not parsed as a queue name.
 *   - No duplicates across the object.
 *
 * Adding a queue: add the key + value here, add JobData/JobResult types to
 * queue/types.ts, add per-queue concurrency to pipeline-service/worker.ts.
 * The three locations are coupled on purpose — a new queue without a type or
 * processor is dead weight.
 *
 * Domains:
 *   gap-score-*      v2 Part 2.7 — trigger-driven + featured-baseline + backfill
 *   paper-trading-*  Phase 11 §11.8 — strategy gen, execution, monitoring, aggregation
 */

export const QUEUE_NAMES = {
  // ── Gap Score (v2 Part 2.7) ──
  GAP_SCORE_FEATURED_BASELINE: 'gap-score-featured-baseline',
  GAP_SCORE_CANDIDATE_COMPUTE: 'gap-score-candidate-compute',
  GAP_SCORE_BACKFILL: 'gap-score-backfill',
  // Phase 1c.2b.1: per-entity baseline recompute worker tick.
  GAP_SCORE_BASELINE_COMPUTE: 'gap-score-baseline-compute',

  // ── Trigger + Candidate infrastructure (Phase 1c) ──
  CANDIDATE_GENERATOR: 'candidate-generator',
  TRIGGER_SCAN: 'trigger-scan',

  // ── Macro consensus scraping (Phase 1c.2a) ──
  // Distinct queue from trigger-scan: different retry semantics (long
  // backoff on HTML scraper failures) and independent concurrency tuning.
  MACRO_CONSENSUS_SCRAPE: 'macro-consensus-scrape',

  // ── Narrative + Psych ingestion (Phase 1c.2b.1) ──
  // Separate queue domain so narrative/psych pollers can scale with
  // different concurrency + retry than trigger-scan + consensus scraping.
  NARRATIVE_INGEST: 'narrative-ingest',
  PSYCH_INGEST: 'psych-ingest',

  // ── Paper Trading (Phase 11 §11.8) ──
  PAPER_TRADING_STRATEGY_GENERATE: 'paper-trading-strategy-generate',
  PAPER_TRADING_EXECUTE: 'paper-trading-execute',
  PAPER_TRADING_MONITOR_POSITIONS: 'paper-trading-monitor-positions',
  PAPER_TRADING_AGGREGATE_PERFORMANCE: 'paper-trading-aggregate-performance',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

/** All queue names as an array — useful for iteration in the worker host. */
export const ALL_QUEUE_NAMES: readonly QueueName[] = Object.freeze(
  Object.values(QUEUE_NAMES),
)
