/**
 * Shared retry + retention defaults applied to every job enqueued via the
 * Queue factory. Centralized so per-queue overrides stay the exception, not
 * the rule.
 *
 * Defaults (approved in Phase 1a manifest):
 *   - attempts: 3
 *   - backoff:  exponential starting at 5s → 5s, 10s, 20s
 *   - removeOnComplete: last 100 per queue (keeps recent successes visible
 *     in admin UI without unbounded Redis growth)
 *   - removeOnFail: last 1000 per queue (failed jobs matter for debugging;
 *     bigger buffer justified)
 *
 * Phase 1b consideration: paper-trading:monitor-positions runs every 5 min
 * and will dominate Redis memory if it keeps 100 completed. Override its
 * retention in the processor definition when it lands.
 */

import type { JobsOptions } from 'bullmq'

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1000 },
}
