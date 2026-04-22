/**
 * One-shot verification that Phase 1c.2a migration applied cleanly.
 * Checks:
 *   1. RawSignalLayer.storyClusterId + entityId nullability
 *   2. RawSignalQueue.storyClusterId + entityId nullability
 *   3. TriggerCursor table exists + insert/delete round-trips
 *   4. Existing RawSignalLayer rows retained their storyClusterId values
 */
import 'dotenv/config'
import { prisma } from '../src/lib/db'

async function main() {
  const colInfo = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string; is_nullable: 'YES' | 'NO' }>
  >(
    `SELECT table_name::text AS table_name,
            column_name::text AS column_name,
            is_nullable::text AS is_nullable
     FROM information_schema.columns
     WHERE table_name IN ('RawSignalLayer','RawSignalQueue')
       AND column_name IN ('storyClusterId','entityId')
     ORDER BY table_name, column_name`,
  )
  console.log('── Column nullability ──')
  console.table(colInfo)

  const triggerCursorExists = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count
     FROM information_schema.tables
     WHERE table_name::text = 'TriggerCursor'`,
  )
  console.log('── TriggerCursor table present? ──')
  console.log(`count=${triggerCursorExists[0].count}`)

  // Round-trip: insert + read + delete
  const cursorPing = await prisma.triggerCursor.create({
    data: { triggerId: '__PING__', cursorType: 'test', cursorValue: 'ok' },
  })
  const read = await prisma.triggerCursor.findUnique({
    where: { triggerId_cursorType: { triggerId: '__PING__', cursorType: 'test' } },
  })
  console.log(`── TriggerCursor round-trip: created id=${cursorPing.id} read=${read?.cursorValue}`)
  await prisma.triggerCursor.delete({ where: { id: cursorPing.id } })

  // Existing RawSignalLayer rows retained storyClusterId
  const counts = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; cluster_scoped: bigint; entity_scoped: bigint; unscoped: bigint }>
  >(
    `SELECT
        count(*)::bigint AS total,
        count("storyClusterId")::bigint AS cluster_scoped,
        count("entityId")::bigint AS entity_scoped,
        count(*) FILTER (WHERE "storyClusterId" IS NULL AND "entityId" IS NULL)::bigint AS unscoped
     FROM "RawSignalLayer"`,
  )
  console.log('── RawSignalLayer scope distribution ──')
  console.table(counts)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
