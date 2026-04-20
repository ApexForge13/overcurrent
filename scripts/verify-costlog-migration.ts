/**
 * Verify the SESSION5_STEP1 migration applied to the live DB:
 * confirm flagBreakdown (jsonb) and forceFullQualityActive (bool, default false)
 * are present on the CostLog table via information_schema.
 */
import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
  }>>(
    `SELECT column_name::text AS column_name,
            data_type::text  AS data_type,
            is_nullable::text AS is_nullable,
            column_default::text AS column_default
     FROM information_schema.columns
     WHERE table_name = 'CostLog'
       AND column_name IN ('flagBreakdown', 'forceFullQualityActive')
     ORDER BY column_name`,
  )
  console.log('CostLog new columns:')
  for (const r of rows) {
    console.log(`  ${r.column_name.padEnd(24)} ${r.data_type.padEnd(10)} nullable=${r.is_nullable.padEnd(5)} default=${r.column_default ?? '(none)'}`)
  }
  if (rows.length !== 2) {
    console.error(`✗ expected 2 columns, got ${rows.length}`)
    process.exit(1)
  }
  console.log('✓ both columns present')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
