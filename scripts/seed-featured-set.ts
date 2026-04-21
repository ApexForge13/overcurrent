/**
 * Flag the 15 featured-set entities with isFeatured: true.
 *
 * Must run AFTER seed-entities.ts — expects every identifier in
 * FEATURED_SET_IDENTIFIERS to already exist in TrackedEntity. Missing
 * identifiers are warned (not errored) so operators can spot misalignments
 * without the script bailing mid-run.
 *
 * Idempotent — running twice is a no-op.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { FEATURED_SET_IDENTIFIERS, FEATURED_SET_BREAKDOWN } from '../src/lib/entities/featured-set'

async function main() {
  console.log(`[seed-featured-set] flagging ${FEATURED_SET_IDENTIFIERS.length} featured entities`)
  console.log(`[seed-featured-set] expected breakdown:`, FEATURED_SET_BREAKDOWN)

  // Unflag any currently-featured entities that shouldn't be (idempotency safety)
  await prisma.trackedEntity.updateMany({
    where: {
      isFeatured: true,
      identifier: { notIn: [...FEATURED_SET_IDENTIFIERS] },
    },
    data: { isFeatured: false },
  })

  let flagged = 0
  let missing = 0
  for (const identifier of FEATURED_SET_IDENTIFIERS) {
    const existing = await prisma.trackedEntity.findUnique({ where: { identifier } })
    if (!existing) {
      console.warn(`[seed-featured-set] WARNING: ${identifier} not found in TrackedEntity — run seed-entities.ts first.`)
      missing++
      continue
    }
    if (!existing.isFeatured) {
      await prisma.trackedEntity.update({
        where: { identifier },
        data: { isFeatured: true },
      })
    }
    flagged++
  }

  console.log(`[seed-featured-set] flagged ${flagged} / ${FEATURED_SET_IDENTIFIERS.length} (${missing} missing)`)

  // Verify
  const currentFeatured = await prisma.trackedEntity.count({ where: { isFeatured: true } })
  console.log(`[seed-featured-set] verification: ${currentFeatured} entities currently have isFeatured=true`)
}

main()
  .catch((err) => {
    console.error('[seed-featured-set] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
