/**
 * Sovereign yield catalog — 8 hardcoded yields per Phase 1c amendment.
 *
 * Scope:
 *   - US Treasuries: DGS2, DGS5, DGS10, DGS30 (FRED series IDs, daily)
 *   - Foreign sovereigns (10Y): DE10Y (Germany), JP10Y (Japan),
 *     UK10Y (United Kingdom), IT10Y (Italy) — all via FRED's international
 *     IRLTLT01* monthly series
 *
 * Note on US vs foreign series cadence: US DGSx are daily, foreign IRLTLT01x
 * are monthly. Phase 1c trigger logic handles both; downstream trigger
 * implementations must not assume a specific cadence.
 *
 * Category: 'yield' (new in Phase 1c). Applicable triggers: T-GT5 (move),
 * T-GT6 (gap), T-GT9 (macro surprise — yields are highly sensitive to
 * inflation and rate-policy releases).
 */

import type { TrackedEntityInput } from '../types'

interface YieldSpec {
  identifier: string
  name: string
  fredSeriesId: string
  subcategory: 'us_treasury' | 'foreign_sovereign'
  aliases: string[]
}

const YIELD_TRIGGERS = Object.freeze(['T-GT5', 'T-GT6', 'T-GT9'])

export const YIELD_CATALOG: readonly YieldSpec[] = Object.freeze([
  // US Treasuries (daily, FRED direct)
  { identifier: 'DGS2',  name: 'US 2-Year Treasury Yield',  fredSeriesId: 'DGS2',  subcategory: 'us_treasury',       aliases: ['2Y Yield', 'US 2Y', '2-Year Treasury'] },
  { identifier: 'DGS5',  name: 'US 5-Year Treasury Yield',  fredSeriesId: 'DGS5',  subcategory: 'us_treasury',       aliases: ['5Y Yield', 'US 5Y', '5-Year Treasury'] },
  { identifier: 'DGS10', name: 'US 10-Year Treasury Yield', fredSeriesId: 'DGS10', subcategory: 'us_treasury',       aliases: ['10Y Yield', 'US 10Y', '10-Year Treasury'] },
  { identifier: 'DGS30', name: 'US 30-Year Treasury Yield', fredSeriesId: 'DGS30', subcategory: 'us_treasury',       aliases: ['30Y Yield', 'US 30Y', '30-Year Treasury'] },
  // Foreign sovereigns (10Y, monthly OECD harmonized from FRED)
  { identifier: 'DE10Y', name: 'Germany 10-Year Bund Yield',fredSeriesId: 'IRLTLT01DEM156N', subcategory: 'foreign_sovereign', aliases: ['Bund', 'German 10Y', 'DE 10Y'] },
  { identifier: 'JP10Y', name: 'Japan 10-Year JGB Yield',   fredSeriesId: 'IRLTLT01JPM156N', subcategory: 'foreign_sovereign', aliases: ['JGB', 'Japan 10Y', 'JP 10Y'] },
  { identifier: 'UK10Y', name: 'UK 10-Year Gilt Yield',     fredSeriesId: 'IRLTLT01GBM156N', subcategory: 'foreign_sovereign', aliases: ['Gilt', 'UK 10Y', 'GB 10Y'] },
  { identifier: 'IT10Y', name: 'Italy 10-Year BTP Yield',   fredSeriesId: 'IRLTLT01ITM156N', subcategory: 'foreign_sovereign', aliases: ['BTP', 'Italy 10Y', 'IT 10Y'] },
])

export function loadYieldEntities(): TrackedEntityInput[] {
  return YIELD_CATALOG.map((spec) => ({
    identifier: spec.identifier,
    name: spec.name,
    category: 'yield' as const,
    subcategory: spec.subcategory,
    providerIds: {
      fredSeriesId: spec.fredSeriesId,
    },
    groundTruthMap: {
      applicableTriggers: [...YIELD_TRIGGERS],
    },
    entityStrings: {
      aliases: Array.from(new Set([spec.identifier, spec.name, ...spec.aliases])),
    },
  }))
}
