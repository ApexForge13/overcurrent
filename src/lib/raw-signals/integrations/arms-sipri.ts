/**
 * SIPRI Arms Transfer Database — stubbed live integration.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: SIPRI publishes their Arms Transfers Database as a downloadable
 *    dataset, not a live REST API. A rigorous integration requires a local
 *    cache of the SIPRI data — Phase 10 backfill wires that up.
 *
 *    For Phase 6, this runner returns a null result with status='skipped'
 *    so the queue entry is audited but no fabricated data is written.
 *    When Phase 10 lands, swap the fetch in without touching the runner
 *    interface.
 */

import type { IntegrationRunner } from '../runner'

export const armsSipriRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  // Returning null marks the queue entry as 'skipped' with the reason below.
  console.log(
    `[raw-signals/arms-sipri] Stub — requires SIPRI local dataset (Phase 10 backfill). Cluster=${cluster.id.substring(0, 8)}`,
  )
  return null
}
