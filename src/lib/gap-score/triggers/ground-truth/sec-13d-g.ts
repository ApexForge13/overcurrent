/**
 * T-GT2 — SEC 13D/G activist stake disclosed.
 *
 * PHASE 1c.1 STATUS: scaffolded stub — returns []. Shares the SEC EDGAR
 * adapter refactor/direct-call dependency with T-GT1 (see sec-form-4.ts).
 * Scoped to Phase 1c.2.
 *
 * Fire criteria (per Phase 1 addendum A1.4 T-GT2):
 *   - Any new 13D or 13G filing on a tracked equity
 * Severity: 1.0 (large stake accumulation is always material).
 * Direction: +1 default; known short-seller activists reverse to -1
 *            (hand-curated list, loaded via config in Phase 1c.2).
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

export async function sec13DGTrigger(_ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  // PHASE 1c.2 IMPLEMENTATION: EDGAR search for forms=SC 13D,SC 13G,
  // match issuer CIK to TrackedEntity, emit severity=1.0 fire.
  return []
}
