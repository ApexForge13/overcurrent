/**
 * FEWS NET — Famine Early Warning System food-insecurity classifications.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: FEWS NET publishes IPC-classified food-security maps + reports.
 *    No public REST API — the data is distributed as shapefiles + PDFs via
 *    fews.net/data-portal. Phase 10 backfill wires a local cache.
 *
 *    For Phase 6 this stub returns null. When Phase 10 ships the data
 *    cache, swap in a query that returns the IPC classification for
 *    countries named in the story.
 */

import type { IntegrationRunner } from '../runner'

export const fewsNetRunner: IntegrationRunner = async (ctx) => {
  console.log(
    `[raw-signals/fews-net] Stub — requires Phase 10 local data cache (FEWS publishes shapefiles/PDFs only). Cluster=${ctx.cluster.id.substring(0, 8)}`,
  )
  return null
}
