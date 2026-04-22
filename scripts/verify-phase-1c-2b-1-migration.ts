/**
 * One-shot verification that Phase 1c.2b.1 migration applied cleanly.
 * Checks:
 *   1. EntityObservation + EntityObservationHourly + CftcPosition tables exist
 *   2. Expected columns present on each
 *   3. Unique + secondary indexes landed
 *   4. Foreign keys to TrackedEntity on observation tables
 *   5. Round-trip insert/read/delete for each table via Prisma client
 */
import 'dotenv/config'
import { prisma } from '../src/lib/db'

const TABLES = ['EntityObservation', 'EntityObservationHourly', 'CftcPosition']

async function main() {
  const tableCheck = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_count: bigint }>
  >(
    `SELECT table_name::text AS table_name, count(*)::bigint AS column_count
     FROM information_schema.columns
     WHERE table_name IN ('${TABLES.join("','")}')
     GROUP BY table_name
     ORDER BY table_name`,
  )
  console.log('── Tables present + column counts ──')
  console.table(tableCheck)

  const columns = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>
  >(
    `SELECT table_name::text AS table_name,
            column_name::text AS column_name,
            data_type::text AS data_type,
            is_nullable::text AS is_nullable
     FROM information_schema.columns
     WHERE table_name IN ('${TABLES.join("','")}')
     ORDER BY table_name, ordinal_position`,
  )
  console.log('── Column definitions ──')
  console.table(columns)

  const indexes = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; index_name: string; is_unique: boolean }>
  >(
    `SELECT t.relname::text AS table_name,
            i.relname::text AS index_name,
            ix.indisunique AS is_unique
     FROM pg_class t, pg_class i, pg_index ix
     WHERE t.oid = ix.indrelid
       AND i.oid = ix.indexrelid
       AND t.relname IN ('${TABLES.join("','")}')
     ORDER BY t.relname, i.relname`,
  )
  console.log('── Indexes ──')
  console.table(indexes)

  const fks = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; constraint_name: string; references_table: string }>
  >(
    `SELECT tc.table_name::text AS table_name,
            tc.constraint_name::text AS constraint_name,
            ccu.table_name::text AS references_table
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
     WHERE tc.table_name IN ('${TABLES.join("','")}')
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.table_name`,
  )
  console.log('── Foreign keys ──')
  console.table(fks)

  // Round-trip via Prisma client — pick any TrackedEntity to satisfy FK
  const anyEntity = await prisma.trackedEntity.findFirst({ select: { id: true, identifier: true } })
  if (!anyEntity) {
    console.log('── Round-trip skipped: no TrackedEntity available ──')
    return
  }

  console.log(`── Round-trip using entity ${anyEntity.identifier} (${anyEntity.id}) ──`)

  const obs = await prisma.entityObservation.create({
    data: {
      entityId: anyEntity.id,
      sourceType: 'gdelt_article',
      outlet: 'verify.test',
      sourceUrl: `https://verify.test/ping/${Date.now()}`,
      title: 'verification ping',
      engagement: null,
      observedAt: new Date(),
    },
  })
  console.log(`  EntityObservation create ok: ${obs.id}`)

  const hourly = await prisma.entityObservationHourly.create({
    data: {
      entityId: anyEntity.id,
      metricName: '__verify__',
      hourStart: new Date(),
      count: 1,
      engagementSum: null,
    },
  })
  console.log(`  EntityObservationHourly create ok: ${hourly.id}`)

  const cftc = await prisma.cftcPosition.create({
    data: {
      marketCode: '__VERIFY__',
      exchangeCode: 'VER',
      marketName: 'Verification',
      reportDate: new Date(),
      managedMoneyLongPct: 0.1,
      managedMoneyShortPct: 0.05,
      managedMoneyNetPct: 0.05,
      producerNetPct: null,
      swapDealerNetPct: null,
      openInterestTotal: 100,
    },
  })
  console.log(`  CftcPosition create ok: ${cftc.id}`)

  // Clean up
  await prisma.entityObservation.delete({ where: { id: obs.id } })
  await prisma.entityObservationHourly.delete({ where: { id: hourly.id } })
  await prisma.cftcPosition.delete({ where: { id: cftc.id } })
  console.log('  All round-trip rows cleaned up.')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
