/**
 * Port State Control — Tokyo + Paris MOU vessel detention records.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Both Tokyo MOU (tokyo-mou.org/casualty_and_inspection/inspection_search)
 *    and Paris MOU (parismou.org/inspection-search) publish HTML-table
 *    detention lists, not JSON APIs. A rigorous integration requires HTML
 *    scraping with a vessel-name or IMO-number query.
 *
 *    For Phase 6 this runner is stubbed — returning null so the queue entry
 *    is audited. Phase 10 backfill wires a maintained local detention
 *    index that this runner will query going forward.
 */

import type { IntegrationRunner } from '../runner'

export const portStateControlRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  console.log(
    `[raw-signals/port-state] Stub — requires Phase 10 scraping pipeline for Tokyo/Paris MOU HTML tables. Cluster=${ctx.cluster.id.substring(0, 8)}`,
  )
  return null
}
