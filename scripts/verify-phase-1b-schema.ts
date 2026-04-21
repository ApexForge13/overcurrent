/**
 * Phase 1b schema verification — confirms the migration landed cleanly.
 *
 * For each new table, runs a zero-row `findMany({ take: 0 })` against the
 * live DB. If the table is missing, Prisma throws a P2021 "The table
 * ... does not exist" error.
 *
 * For CostLog, runs a zero-row select that references every new column
 * explicitly — missing columns fail at the PostgreSQL level.
 *
 * Idempotent and read-only. Safe to run whenever.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'

const NEW_TABLES = [
  'trackedEntity',
  'triggerEvent',
  'scoredSignal',
  'gapScore',
  'watchlist',
  'alert',
  'caseStudy',
  'hotListSnapshot',
  'promptVersion',
  'macroRelease',
  'macroIndicatorConfig',
  'zoneBaseline',
  'entityBaseline',
] as const

async function main() {
  console.log('\n━━━ Phase 1b schema verification ━━━\n')

  // ── Part 1: confirm each new table exists ──
  const tableResults: Array<{ table: string; status: string; rowCount?: number; error?: string }> = []
  for (const table of NEW_TABLES) {
    try {
      // @ts-expect-error — indexing the runtime client by string is OK here
      const count = await prisma[table].count()
      tableResults.push({ table, status: 'ok', rowCount: count })
    } catch (err) {
      tableResults.push({
        table,
        status: 'MISSING',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const tableCol = 24
  const statusCol = 10
  console.log('Table'.padEnd(tableCol) + 'Status'.padEnd(statusCol) + 'Rows')
  console.log('─'.repeat(tableCol + statusCol + 6))
  for (const r of tableResults) {
    const rows = r.rowCount === undefined ? '—' : String(r.rowCount)
    console.log(r.table.padEnd(tableCol) + r.status.padEnd(statusCol) + rows)
    if (r.error) console.log(`  ↳ ${r.error.slice(0, 200)}`)
  }

  const missingTables = tableResults.filter((r) => r.status !== 'ok')

  // ── Part 2: confirm CostLog has the 5 new columns ──
  console.log('\n━━━ CostLog extension columns ━━━\n')
  const expectedCols = ['service', 'operation', 'entityId', 'signalsProcessed', 'metadata'] as const
  let costLogOk = true
  let costLogError: string | undefined
  try {
    // PostgreSQL information_schema query is authoritative — doesn't depend
    // on whether the Prisma client is fresh.
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name::text AS column_name
      FROM information_schema.columns
      WHERE table_name = 'CostLog'
        AND column_name::text = ANY(${expectedCols as unknown as string[]})
    `
    const found = new Set(rows.map((r) => r.column_name))
    for (const col of expectedCols) {
      const present = found.has(col)
      console.log(`  ${present ? '✓' : '✗'} CostLog.${col}`)
      if (!present) costLogOk = false
    }
  } catch (err) {
    costLogOk = false
    costLogError = err instanceof Error ? err.message : String(err)
    console.log(`  ERROR: ${costLogError}`)
  }

  // ── Part 3: confirm CostLog indexes ──
  console.log('\n━━━ CostLog new indexes ━━━\n')
  const expectedIndexes = ['CostLog_service_createdAt_idx', 'CostLog_entityId_idx']
  let indexesOk = true
  try {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname::text AS indexname
      FROM pg_indexes
      WHERE tablename = 'CostLog'
        AND indexname::text = ANY(${expectedIndexes})
    `
    const found = new Set(rows.map((r) => r.indexname))
    for (const idx of expectedIndexes) {
      const present = found.has(idx)
      console.log(`  ${present ? '✓' : '✗'} ${idx}`)
      if (!present) indexesOk = false
    }
  } catch (err) {
    indexesOk = false
    console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Summary ──
  console.log('\n━━━ Summary ━━━\n')
  const passed = missingTables.length === 0 && costLogOk && indexesOk
  console.log(`  Tables:   ${NEW_TABLES.length - missingTables.length}/${NEW_TABLES.length} present`)
  console.log(`  CostLog:  ${costLogOk ? 'all 5 new columns present' : 'columns MISSING'}`)
  console.log(`  Indexes:  ${indexesOk ? 'both new indexes present' : 'indexes MISSING'}`)
  console.log(`\n  Overall:  ${passed ? '✅ PASS — Phase 1b schema is live' : '❌ FAIL — see above'}\n`)

  if (!passed) process.exit(1)
}

main()
  .catch((err) => {
    console.error('[verify] FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
