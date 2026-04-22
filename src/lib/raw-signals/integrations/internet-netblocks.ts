/**
 * NetBlocks — stubbed live integration.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: NetBlocks does not publish a public REST API. Its reports live
 *    on X.com (formerly Twitter) and netblocks.org articles. A rigorous
 *    integration requires scraping the report index at netblocks.org/news
 *    or mirroring X posts via the Twitter API (Phase 9).
 *
 *    For Phase 6, this runner returns null so the queue entry is audited
 *    but no fabricated data is written. Phase 9 (social layer integrations)
 *    will wire NetBlocks via Twitter/X.
 */

import type { IntegrationRunner } from '../runner'

export const netBlocksRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  console.log(
    `[raw-signals/netblocks] Stub — requires scrape or Phase 9 Twitter/X wiring. Cluster=${ctx.cluster.id.substring(0, 8)}`,
  )
  return null
}
