/**
 * FAO — global food price index.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: FAO publishes the Food Price Index + sub-indices (cereals, meat,
 *    dairy, sugar, oils) on fao.org. No live REST API — data ships as
 *    Excel + CSV updated monthly on the FAOSTAT and FPMA pages.
 *
 *    Phase 10 backfill will seed a local FPI cache. For Phase 6 we stub
 *    with a null return — cluster entries are audited but no fabricated
 *    data is written.
 */

import type { IntegrationRunner } from '../runner'

export const faoFoodPriceRunner: IntegrationRunner = async (ctx) => {
  console.log(
    `[raw-signals/fao-food] Stub — requires Phase 10 local FPI cache (FAO publishes monthly CSV). Cluster=${ctx.cluster.id.substring(0, 8)}`,
  )
  return null
}
