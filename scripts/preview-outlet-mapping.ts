/**
 * Dry-run preview of the outlet mapping. Prints what would be written to the
 * Outlet table without touching the DB. Validates that mapOutlet() handles
 * all 483 outlets in the registry without errors.
 *
 * Run: npx tsx scripts/preview-outlet-mapping.ts
 */

import { outlets as outletRegistry } from '../src/data/outlets'
import { mapOutlet } from '../src/lib/outlet-map'

const tierCounts: Record<string, number> = {}
const regionCounts: Record<string, number> = {}
const editorialCounts: Record<string, number> = {}
const byTier: Record<string, string[]> = {}

for (const info of outletRegistry) {
  const row = mapOutlet(info)
  tierCounts[row.tier] = (tierCounts[row.tier] || 0) + 1
  regionCounts[row.region] = (regionCounts[row.region] || 0) + 1
  editorialCounts[row.editorialType] = (editorialCounts[row.editorialType] || 0) + 1
  byTier[row.tier] = byTier[row.tier] || []
  byTier[row.tier].push(`${row.name} (${row.domain}) ${row.country}`)
}

console.log(`\n━━━ OUTLET MAPPING PREVIEW ━━━`)
console.log(`Total outlets processed: ${outletRegistry.length}`)

console.log(`\nBy tier:`)
for (const [tier, count] of Object.entries(tierCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tier.padEnd(15)} ${count}`)
}

console.log(`\nBy region:`)
for (const [region, count] of Object.entries(regionCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${region.padEnd(15)} ${count}`)
}

console.log(`\nBy editorial type:`)
for (const [type, count] of Object.entries(editorialCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(15)} ${count}`)
}

// Spot-check: list tier assignments
for (const tier of ['wire_service', 'national', 'emerging', 'specialty', 'regional', 'unclassified']) {
  console.log(`\n── ${tier.toUpperCase()} (${(byTier[tier] || []).length}) ──`)
  const sample = (byTier[tier] || []).slice(0, 20)
  sample.forEach(s => console.log(`  ${s}`))
  if ((byTier[tier] || []).length > 20) {
    console.log(`  ... and ${(byTier[tier] || []).length - 20} more`)
  }
}
