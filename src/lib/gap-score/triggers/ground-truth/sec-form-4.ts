/**
 * T-GT1 — SEC Form 4 large insider transaction.
 *
 * PHASE 1c.1 STATUS: scaffolded stub — returns []. Full implementation
 * requires either:
 *   (a) Refactoring the existing src/lib/raw-signals/integrations/sec-edgar.ts
 *       adapter to accept non-cluster contexts (it currently requires a
 *       StoryCluster context from the legacy debate pipeline), OR
 *   (b) A direct call to the SEC EDGAR Atom feed
 *       (https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4)
 *       to fetch recent Form 4 filings and match against TrackedEntity
 *       via providerIds.cik.
 *
 * Scoped to Phase 1c.2 alongside the consensus scrapers and remaining
 * data-source integrations. Framework wiring is live — the moment the
 * implementation lands, fires start flowing to TriggerEvent.
 *
 * Fire criteria (per Phase 1 addendum A1.4 T-GT1):
 *   - transaction_value_usd >= 1_000_000, OR
 *   - transaction_size_pct_of_holdings >= 0.10, OR
 *   - ≥2 insiders at same issuer filing same-direction trades within 48h
 * Severity: log-scaled by dollar amount ($1M=0.3, $10M=0.6, $100M+=1.0).
 * Direction: buy = +1, sell = -1.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

export async function secForm4Trigger(_ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  // PHASE 1c.2 IMPLEMENTATION:
  //   1. Fetch recent Form 4 filings via EDGAR Atom feed or search API
  //   2. For each filing, extract issuer CIK + transaction details
  //   3. Look up issuer in TrackedEntity by providerIds.cik
  //   4. If found, evaluate threshold and emit fire with direction per buy/sell
  //   5. Cost-log to service='trigger' operation='sec-form-4-scan'
  return []
}
