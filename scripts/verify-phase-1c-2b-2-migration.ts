import 'dotenv/config'
import { prisma } from '../src/lib/db'

const TABLES = ['TriggerEnablement', 'EarningsSchedule']

async function main() {
  const cols = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>
  >(
    `SELECT table_name::text AS table_name, column_name::text AS column_name,
            data_type::text AS data_type, is_nullable::text AS is_nullable
     FROM information_schema.columns
     WHERE table_name IN ('${TABLES.join("','")}')
     ORDER BY table_name, ordinal_position`,
  )
  console.log('── Column definitions ──')
  console.table(cols)

  const indexes = await prisma.$queryRawUnsafe<
    Array<{ table_name: string; index_name: string; is_unique: boolean }>
  >(
    `SELECT t.relname::text AS table_name, i.relname::text AS index_name,
            ix.indisunique AS is_unique
     FROM pg_class t, pg_class i, pg_index ix
     WHERE t.oid = ix.indrelid AND i.oid = ix.indexrelid
       AND t.relname IN ('${TABLES.join("','")}')
     ORDER BY t.relname, i.relname`,
  )
  console.log('── Indexes ──')
  console.table(indexes)

  // Round-trip via Prisma client
  const te = await prisma.triggerEnablement.create({
    data: { triggerId: '__VERIFY__', enabled: true, thresholdOverrides: { test: 1 } },
  })
  console.log(`TriggerEnablement round-trip ok: ${te.id}`)
  await prisma.triggerEnablement.delete({ where: { id: te.id } })

  const anyEntity = await prisma.trackedEntity.findFirst({ select: { id: true, identifier: true } })
  if (anyEntity) {
    const es = await prisma.earningsSchedule.create({
      data: {
        entityId: anyEntity.id,
        ticker: anyEntity.identifier,
        reportDate: new Date('2099-01-01T00:00:00Z'),
        confirmed: false,
      },
    })
    console.log(`EarningsSchedule round-trip ok: ${es.id} (entity=${anyEntity.identifier})`)
    await prisma.earningsSchedule.delete({ where: { id: es.id } })
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1) })
