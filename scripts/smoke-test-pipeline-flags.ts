/**
 * Smoke test — verify the cost-optimization foundation end-to-end without
 * incurring API costs:
 *
 *   1. Set PIPELINE_FORCE_FULL_QUALITY=1 on the resolver and confirm all five
 *      flags resolve off + forceFullQualityActive=true.
 *   2. Print the warning string that runVerifyPipeline emits.
 *   3. Call writePipelineSavingsSummary() with synthetic input and read the
 *      CostLog row back to confirm flagBreakdown JSON + forceFullQualityActive
 *      column round-trip correctly through the live DB.
 *
 * Cost: $0 (no API calls). Runtime: under 5s.
 *
 * Run: npx tsx scripts/smoke-test-pipeline-flags.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import {
  resolveFlags,
  formatForceFullQualityWarning,
  writePipelineSavingsSummary,
  ALL_FLAGS,
} from '../src/lib/pipeline-flags'

dotenvConfig({ override: true })

async function main() {
  console.log('\n━━━ COST-OPTIMIZATION FOUNDATION SMOKE TEST ━━━\n')

  // ── (1) Resolver with PIPELINE_FORCE_FULL_QUALITY=1 ──
  console.log('STEP 1 — resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: "1" } })')
  const flags = resolveFlags({ env: { PIPELINE_FORCE_FULL_QUALITY: '1' } })
  console.log(`  forceFullQualityActive: ${flags.forceFullQualityActive}`)
  console.log(`  flagsActive:            ${JSON.stringify(flags.flagsActive)}`)
  console.log(`  flagsForcedOff:         ${JSON.stringify(flags.flagsForcedOff)}`)
  if (!flags.forceFullQualityActive) throw new Error('Expected forceFullQualityActive=true')
  if (flags.flagsActive.length !== 0) throw new Error('Expected flagsActive=[]')
  if (flags.flagsForcedOff.length !== ALL_FLAGS.length) throw new Error('Expected all 5 flags forced off')
  for (const flagName of ALL_FLAGS) {
    if (flags[flagName] !== false) throw new Error(`Flag ${flagName} expected false, got ${flags[flagName]}`)
  }
  console.log('  ✓ resolver behavior correct\n')

  // ── (2) Warning string ──
  console.log('STEP 2 — warning string emitted by pipeline when force-full is active:')
  console.log(`  ${formatForceFullQualityWarning()}`)
  console.log('  ✓ warning visible in stdout\n')

  // ── (3) Write the summary row + read it back ──
  console.log('STEP 3 — writePipelineSavingsSummary() with synthetic force-full input')
  const written = await writePipelineSavingsSummary({
    storyId: null, // smoke test row, not associated with a real Story
    flags,
    actualCostUsd: 12.34,
    estimatedFullCostUsd: 12.34, // force-full → no savings by definition
  })
  console.log(`  wrote CostLog id=${written.id}`)
  console.log(`  flagBreakdown returned by writer:`)
  console.log(JSON.stringify(written.flagBreakdown, null, 2).split('\n').map((l) => '    ' + l).join('\n'))

  const row = await prisma.costLog.findUnique({
    where: { id: written.id },
    select: {
      id: true,
      agentType: true,
      model: true,
      costUsd: true,
      forceFullQualityActive: true,
      flagBreakdown: true,
      createdAt: true,
    },
  })
  if (!row) throw new Error(`Round-trip failed: row ${written.id} not found`)
  console.log(`\n  ROUND-TRIP READ from CostLog row ${row.id.substring(0, 8)}:`)
  console.log(`    agentType:              ${row.agentType}`)
  console.log(`    model:                  ${row.model}`)
  console.log(`    costUsd:                ${row.costUsd}`)
  console.log(`    forceFullQualityActive: ${row.forceFullQualityActive}`)
  console.log(`    createdAt:              ${row.createdAt.toISOString()}`)
  console.log(`    flagBreakdown:          ${JSON.stringify(row.flagBreakdown)}`)

  // Assertions
  if (row.agentType !== 'pipeline_savings') throw new Error(`agentType mismatch`)
  if (row.forceFullQualityActive !== true) throw new Error(`forceFullQualityActive mismatch`)
  if (!row.flagBreakdown) throw new Error(`flagBreakdown is null after roundtrip`)
  const fb = row.flagBreakdown as Record<string, unknown>
  if (fb.actualCostUsd !== 12.34) throw new Error(`flagBreakdown.actualCostUsd mismatch`)
  if (fb.savingsUsd !== 0) throw new Error(`flagBreakdown.savingsUsd should be 0 under force-full`)
  if (fb.forceFullQualityActive !== true) throw new Error(`flagBreakdown.forceFullQualityActive mismatch`)
  if (!Array.isArray(fb.flagsForcedOff) || fb.flagsForcedOff.length !== 5) {
    throw new Error(`flagBreakdown.flagsForcedOff should be array of 5 names`)
  }
  console.log('  ✓ round-trip read matches written values\n')

  // ── (4) Also test a flags-on case to confirm forceFullQualityActive=false works ──
  console.log('STEP 4 — same writer with flags-on (default) input to confirm forceFullQualityActive=false roundtrips')
  const flagsOn = resolveFlags({ env: {} })
  const onWritten = await writePipelineSavingsSummary({
    storyId: null,
    flags: flagsOn,
    actualCostUsd: 5.25,
    estimatedFullCostUsd: 12.50,
  })
  const onRow = await prisma.costLog.findUnique({
    where: { id: onWritten.id },
    select: { forceFullQualityActive: true, flagBreakdown: true },
  })
  if (!onRow) throw new Error('flags-on row not found')
  if (onRow.forceFullQualityActive !== false) throw new Error('flags-on row should have forceFullQualityActive=false')
  const onFb = onRow.flagBreakdown as Record<string, unknown>
  if (onFb.savingsUsd !== 7.25) throw new Error(`flags-on savingsUsd should be 7.25, got ${onFb.savingsUsd}`)
  console.log(`  wrote CostLog id=${onWritten.id} | forceFullQualityActive=false | savings=$${onFb.savingsUsd}`)
  console.log('  ✓ flags-on row also round-trips correctly\n')

  console.log('━━━ ALL FOUNDATION CHECKS PASSED ━━━\n')
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
