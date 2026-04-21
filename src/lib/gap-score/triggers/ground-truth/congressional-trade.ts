/**
 * T-GT10 — Congressional trade disclosure.
 *
 * PHASE 1c.1 STATUS: scaffolded stub — returns []. Full implementation
 * requires refactoring the existing `src/ingestion/congress.ts` (legacy,
 * tied to the gated debate pipeline) to emit entity-linked events without
 * a cluster context, or writing a new Clerk-of-the-House / Senate-Ethics
 * scraper that writes to TrackedEntity directly.
 *
 * Skipped-disclosure audit path (per user decision): when a disclosure
 * references a ticker that doesn't resolve to a TrackedEntity, write a
 * CostLog row with service='trigger', operation='congressional-trade-
 * unmatched-ticker', metadata={ticker, member, filing_url}. Queryable
 * audit trail for registry-expansion signal.
 *
 * Fire criteria (per Phase 1 addendum A1.4 T-GT10):
 *   - Disclosure lands on tracked ticker (base severity 0.4)
 *   - Elevation +0.2 each (cap 1.0): transaction > $50K, ≥2 members same
 *     ticker within 30d, member on committee with sector jurisdiction
 * Direction: buy = +1, sell = -1.
 *
 * Scoped to Phase 1c.2.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

export async function congressionalTradeTrigger(
  _ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  // PHASE 1c.2 IMPLEMENTATION:
  //   1. Poll House/Senate periodic transaction reports
  //   2. For each disclosure, extract ticker + member + amount + date
  //   3. Look up ticker in TrackedEntity.identifier
  //   4. If found: evaluate elevation conditions, emit fire
  //   5. If not found: cost-log as unmatched-ticker for registry expansion
  return []
}
