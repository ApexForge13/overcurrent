/**
 * Seed MacroIndicatorConfig rows for all ~20 Phase 1b indicators.
 *
 * Populates each with:
 *   - displayName, category, releaseSchedule, unit-independent metadata
 *   - directionMapping from direction-maps.ts (NOT an empty JSON blob —
 *     per user's Phase 1b refinement)
 *   - relevantAssets from the indicator spec
 *   - historicalStddev defaults to 1.0 with historicalStddevProxy=true;
 *     load-historical-macro.ts replaces with computed proxy after loading
 *     MacroRelease rows
 *
 * Idempotent. Direction mappings are updatable — re-run after editing
 * direction-maps.ts to push revised values.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { FRED_INDICATORS } from '../src/lib/historical-data/fred-client'
import { EIA_INDICATORS } from '../src/lib/historical-data/eia-client'
import { USDA_INDICATORS } from '../src/lib/historical-data/usda-client'
import { MACRO_DIRECTION_MAPS } from '../src/lib/historical-data/direction-maps'

interface IndicatorSeed {
  indicator: string
  displayName: string
  category: string
  releaseSchedule: string
  relevantAssets: string[]
}

const ALL_INDICATORS: IndicatorSeed[] = [
  ...FRED_INDICATORS.map((i) => ({
    indicator: i.seriesId,
    displayName: i.displayName,
    category: i.category,
    releaseSchedule: i.releaseSchedule,
    relevantAssets: [...i.relevantAssets],
  })),
  ...EIA_INDICATORS.map((i) => ({
    indicator: i.seriesId,
    displayName: i.displayName,
    category: i.category,
    releaseSchedule: i.releaseSchedule,
    relevantAssets: [...i.relevantAssets],
  })),
  ...USDA_INDICATORS.map((i) => ({
    indicator: i.seriesId,
    displayName: i.displayName,
    category: i.category,
    releaseSchedule: i.releaseSchedule,
    relevantAssets: [...i.relevantAssets],
  })),
]

async function main() {
  console.log(`[seed-macro-config] seeding ${ALL_INDICATORS.length} indicators`)
  let upsertedCount = 0
  let withoutDirectionMap = 0

  for (const spec of ALL_INDICATORS) {
    const directionMap = MACRO_DIRECTION_MAPS[spec.indicator]
    if (!directionMap) {
      console.warn(`[seed-macro-config] WARNING: no direction map for ${spec.indicator}; seeding with empty map`)
      withoutDirectionMap++
    }
    await prisma.macroIndicatorConfig.upsert({
      where: { indicator: spec.indicator },
      create: {
        indicator: spec.indicator,
        displayName: spec.displayName,
        category: spec.category,
        releaseSchedule: spec.releaseSchedule,
        historicalStddev: 1.0, // placeholder; load-historical-macro.ts replaces
        historicalStddevProxy: true,
        directionMapping: (directionMap ?? {}) as object,
        relevantAssets: spec.relevantAssets,
      },
      update: {
        displayName: spec.displayName,
        category: spec.category,
        releaseSchedule: spec.releaseSchedule,
        directionMapping: (directionMap ?? {}) as object,
        relevantAssets: spec.relevantAssets,
      },
    })
    upsertedCount++
  }
  console.log(`[seed-macro-config] done — ${upsertedCount} indicators (${withoutDirectionMap} missing direction map)`)
}

main()
  .catch((err) => {
    console.error('[seed-macro-config] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
