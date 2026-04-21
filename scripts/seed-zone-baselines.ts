/**
 * Seed initial ZoneBaseline rows — 40 zones × 4 metrics = 160 rows, all
 * sampleCount=0, isMature=false. Creates rows so the baseline refresher
 * has upsert targets and so the admin UI can render "calibrating — 30 days
 * remaining" for each zone on day 1.
 *
 * Idempotent — re-running is a no-op.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { TIER_1_ZONES, ZONE_METRIC_NAMES } from '../src/lib/gap-score/zones/tier-1-zones'
import { minSampleSize } from '../src/lib/baselines/maturity'

const WINDOW_DAYS = 30

async function main() {
  console.log(`[seed-zone-baselines] ${TIER_1_ZONES.length} zones × ${ZONE_METRIC_NAMES.length} metrics = ${TIER_1_ZONES.length * ZONE_METRIC_NAMES.length} rows`)
  let created = 0
  let existing = 0
  for (const zone of TIER_1_ZONES) {
    for (const metric of ZONE_METRIC_NAMES) {
      const floor = minSampleSize(metric)
      const result = await prisma.zoneBaseline.upsert({
        where: {
          zoneId_metricName_windowDays: {
            zoneId: zone.id,
            metricName: metric,
            windowDays: WINDOW_DAYS,
          },
        },
        create: {
          zoneId: zone.id,
          metricName: metric,
          windowDays: WINDOW_DAYS,
          mean: 0,
          stddev: 0,
          sampleCount: 0,
          minSampleSize: floor,
          isMature: false,
        },
        update: {}, // idempotent — don't touch existing
      })
      if (result.sampleCount === 0 && !result.isMature) created++
      else existing++
    }
  }
  console.log(`[seed-zone-baselines] done — rows present: ${created + existing}`)
}

main()
  .catch((err) => {
    console.error('[seed-zone-baselines] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
