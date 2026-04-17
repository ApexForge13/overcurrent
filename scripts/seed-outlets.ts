/**
 * Seed the Outlet DB table from src/data/outlets.ts.
 * Idempotent — uses upsert keyed by normalized domain.
 *
 * Run: npx tsx scripts/seed-outlets.ts
 *
 * Requires: Outlet table must exist (apply Session 1 migration first).
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { outlets as outletRegistry } from '../src/data/outlets'
import { mapOutlet } from '../src/lib/outlet-map'

async function main() {
  console.log(`\n━━━ OUTLET SEED ━━━`)
  console.log(`Loading ${outletRegistry.length} outlets from registry...`)

  let created = 0
  let updated = 0
  let skipped = 0
  const tierCounts: Record<string, number> = {}
  const regionCounts: Record<string, number> = {}
  const editorialTypeCounts: Record<string, number> = {}

  for (const info of outletRegistry) {
    const row = mapOutlet(info)
    tierCounts[row.tier] = (tierCounts[row.tier] || 0) + 1
    regionCounts[row.region] = (regionCounts[row.region] || 0) + 1
    editorialTypeCounts[row.editorialType] = (editorialTypeCounts[row.editorialType] || 0) + 1

    try {
      const existing = await prisma.outlet.findUnique({ where: { domain: row.domain } })

      if (!existing) {
        await prisma.outlet.create({ data: row })
        created++
      } else {
        // Don't clobber manual tier overrides — preserve if set
        const shouldKeepTier = existing.tierOverriddenBy !== null
        const updateData = {
          ...row,
          tier: shouldKeepTier ? existing.tier : row.tier,
          // Never clobber override metadata
          tierOverriddenBy: existing.tierOverriddenBy,
          tierOverriddenAt: existing.tierOverriddenAt,
        }
        await prisma.outlet.update({ where: { domain: row.domain }, data: updateData })
        updated++
      }
    } catch (err) {
      console.error(`[seed] Failed on ${row.domain}:`, err instanceof Error ? err.message : err)
      skipped++
    }
  }

  console.log(`\n━━━ SEED COMPLETE ━━━`)
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped (errors): ${skipped}`)
  console.log(`\nBy tier:`)
  for (const [tier, count] of Object.entries(tierCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tier.padEnd(15)} ${count}`)
  }
  console.log(`\nBy region:`)
  for (const [region, count] of Object.entries(regionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${region.padEnd(15)} ${count}`)
  }
  console.log(`\nBy editorial type:`)
  for (const [type, count] of Object.entries(editorialTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(15)} ${count}`)
  }

  const total = await prisma.outlet.count()
  console.log(`\nTotal rows in Outlet table: ${total}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
