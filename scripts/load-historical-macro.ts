/**
 * Load 5yr of macro + commodity inventory history.
 *
 * For each indicator:
 *   1. Fetch historical observations from FRED / EIA / USDA
 *   2. Upsert MacroRelease rows (one per release date), actualValue only
 *      — Phase 1b has no consensus data (scraper is Phase 1c), so consensus
 *      and surprise fields stay null
 *   3. Compute release-to-release stddev proxy from actuals
 *   4. Update MacroIndicatorConfig.historicalStddev with the proxy value
 *      (historicalStddevProxy stays true until Phase 1c populates real
 *      surprise data)
 *
 * Prerequisites:
 *   - MacroIndicatorConfig seeded (run seed-macro-config.ts first)
 *   - FRED_API_KEY in .env (free — https://fred.stlouisfed.org/docs/api/api_key.html)
 *   - EIA_API_KEY in .env  (free — https://www.eia.gov/opendata/register.php)
 *   - USDA no key needed; Phase 1b stub returns [] (see usda-client.ts)
 *
 * Idempotent — upserts by (indicator, releaseDate). Safe to re-run.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { FRED_INDICATORS, fetchFredSeries } from '../src/lib/historical-data/fred-client'
import { EIA_INDICATORS, fetchEiaSeries } from '../src/lib/historical-data/eia-client'
import { USDA_INDICATORS, fetchUsdaSeries } from '../src/lib/historical-data/usda-client'
import { computeSurpriseProxy } from '../src/lib/historical-data/surprise-proxy'

async function main() {
  console.log('[load-historical-macro] starting 5yr macro history load')
  const counts = { fred: 0, eia: 0, usda: 0 }

  // ── FRED indicators ──
  for (const spec of FRED_INDICATORS) {
    try {
      console.log(`[load-historical-macro] fetching FRED ${spec.seriesId}...`)
      const observations = await fetchFredSeries(spec.seriesId)
      for (const obs of observations) {
        await prisma.macroRelease.upsert({
          where: { indicator_releaseDate: { indicator: spec.seriesId, releaseDate: new Date(obs.date) } },
          create: {
            indicator: spec.seriesId,
            releaseDate: new Date(obs.date),
            actualValue: obs.value,
            actualReleased: new Date(obs.date),
            unit: spec.unit,
          },
          update: { actualValue: obs.value, actualReleased: new Date(obs.date), unit: spec.unit },
        })
        counts.fred++
      }
      await updateIndicatorStddev(spec.seriesId, observations)
      console.log(`[load-historical-macro] FRED ${spec.seriesId}: ${observations.length} observations`)
    } catch (err) {
      console.error(`[load-historical-macro] FRED ${spec.seriesId} failed:`, err instanceof Error ? err.message : err)
    }
  }

  // ── EIA indicators ──
  for (const spec of EIA_INDICATORS) {
    try {
      console.log(`[load-historical-macro] fetching EIA ${spec.seriesId}...`)
      const observations = await fetchEiaSeries(spec)
      for (const obs of observations) {
        await prisma.macroRelease.upsert({
          where: { indicator_releaseDate: { indicator: spec.seriesId, releaseDate: new Date(obs.periodEnd) } },
          create: {
            indicator: spec.seriesId,
            releaseDate: new Date(obs.periodEnd),
            actualValue: obs.value,
            actualReleased: new Date(obs.periodEnd),
            unit: obs.unit,
          },
          update: { actualValue: obs.value, actualReleased: new Date(obs.periodEnd), unit: obs.unit },
        })
        counts.eia++
      }
      await updateIndicatorStddev(spec.seriesId, observations.map((o) => ({ date: o.periodEnd, value: o.value })))
      console.log(`[load-historical-macro] EIA ${spec.seriesId}: ${observations.length} observations`)
    } catch (err) {
      console.error(`[load-historical-macro] EIA ${spec.seriesId} failed:`, err instanceof Error ? err.message : err)
    }
  }

  // ── USDA indicators (Phase 1b stub returns []; no writes) ──
  for (const spec of USDA_INDICATORS) {
    try {
      const observations = await fetchUsdaSeries(spec)
      for (const obs of observations) {
        await prisma.macroRelease.upsert({
          where: { indicator_releaseDate: { indicator: spec.seriesId, releaseDate: new Date(obs.periodEnd) } },
          create: {
            indicator: spec.seriesId,
            releaseDate: new Date(obs.periodEnd),
            actualValue: obs.value,
            actualReleased: new Date(obs.periodEnd),
            unit: obs.unit,
          },
          update: { actualValue: obs.value, actualReleased: new Date(obs.periodEnd), unit: obs.unit },
        })
        counts.usda++
      }
      if (observations.length > 0) {
        await updateIndicatorStddev(spec.seriesId, observations.map((o) => ({ date: o.periodEnd, value: o.value })))
      }
      console.log(`[load-historical-macro] USDA ${spec.seriesId}: ${observations.length} observations${observations.length === 0 ? ' (Phase 1b stub)' : ''}`)
    } catch (err) {
      console.error(`[load-historical-macro] USDA ${spec.seriesId} failed:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('[load-historical-macro] summary:', counts)
  console.log(`[load-historical-macro] total MacroRelease rows loaded: ${counts.fred + counts.eia + counts.usda}`)
}

async function updateIndicatorStddev(
  indicator: string,
  observations: ReadonlyArray<{ date: string; value: number }>,
): Promise<void> {
  const proxy = computeSurpriseProxy(observations)
  await prisma.macroIndicatorConfig.update({
    where: { indicator },
    data: {
      historicalStddev: proxy.stddev,
      historicalStddevProxy: true, // stays true until real consensus data lands
    },
  })
}

main()
  .catch((err) => {
    console.error('[load-historical-macro] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
