/**
 * Read-only diagnostic: why is the Hormuz arc not showing up in the
 * admin "rerun existing story arc" picker?
 *
 * Shows all stories in the US-Iran Escalation 2026 umbrella by analysisType,
 * status, arcImportance, arcLabel — plus the arc roots that the picker
 * should be listing.
 *
 * Run: npx tsx scripts/investigate-hormuz-arc.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const UMBRELLA_ID = 'cmo3f21ak000004l11k0vw7if'
const CLUSTER_ID = 'cmo5efugm00c312pikkw7jsl4'
const HORMUZ_ARC_LABEL = 'Strait of Hormuz Tanker Seizures and Insurance Market Reaction'

async function main() {
  console.log('\n━━━ UMBRELLA METADATA ━━━\n')
  const umbrella = await prisma.umbrellaArc.findUnique({
    where: { id: UMBRELLA_ID },
    select: {
      id: true, name: true, status: true, signalCategory: true,
      totalAnalyses: true, storyArcCount: true, oneOffCount: true,
    },
  })
  console.log(umbrella ?? '(umbrella NOT FOUND)')

  console.log('\n━━━ ALL STORIES UNDER US-IRAN ESCALATION 2026 ━━━\n')
  const all = await prisma.story.findMany({
    where: { umbrellaArcId: UMBRELLA_ID },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      analysisType: true,
      arcLabel: true,
      arcImportance: true,
      arcPhaseAtCreation: true,
      arcDesignatedAt: true,
      storyClusterId: true,
      storyPhase: true,
      createdAt: true,
      headline: true,
    },
  })
  for (const s of all) {
    console.log(`─ ${s.id}`)
    console.log(`  type=${s.analysisType} status=${s.status} phase=${s.storyPhase ?? '?'} importance=${s.arcImportance ?? '?'}`)
    console.log(`  arcLabel: ${s.arcLabel ?? '(null)'}`)
    console.log(`  cluster: ${s.storyClusterId}`)
    console.log(`  created: ${s.createdAt.toISOString()}`)
    console.log(`  headline: ${s.headline.substring(0, 100)}${s.headline.length > 100 ? '…' : ''}`)
    console.log()
  }
  console.log(`Total: ${all.length} stories under this umbrella`)

  console.log('\n━━━ ARC ROOTS (analysisType=new_arc) ━━━\n')
  const roots = all.filter((s) => s.analysisType === 'new_arc')
  console.log(`Arc roots: ${roots.length}`)
  for (const r of roots) {
    console.log(`  ${r.id} | importance=${r.arcImportance} | status=${r.status} | "${r.arcLabel ?? r.headline.substring(0, 80)}"`)
  }

  console.log('\n━━━ HORMUZ-LABELED STORIES (any analysisType) ━━━\n')
  const hormuz = all.filter((s) => (s.arcLabel ?? '').toLowerCase().includes('hormuz'))
  for (const h of hormuz) {
    console.log(`  ${h.id} | type=${h.analysisType} | importance=${h.arcImportance ?? '?'} | status=${h.status} | arcLabel="${h.arcLabel}"`)
  }

  console.log('\n━━━ CLUSTER STATE ━━━\n')
  const cluster = await prisma.storyCluster.findUnique({
    where: { id: CLUSTER_ID },
    select: {
      id: true, clusterHeadline: true, currentPhase: true,
      signalCategory: true, canonicalSignalCategory: true,
      totalAnalysesRun: true, arcCompleteness: true,
    },
  })
  console.log(cluster ?? '(cluster NOT FOUND)')

  console.log('\n━━━ WHAT THE PICKER ENDPOINT LIKELY RETURNS ━━━\n')
  console.log('Filters typically applied by /api/admin/umbrellas/[id]/arcs:')
  console.log('  - umbrellaArcId = <this umbrella>')
  console.log('  - analysisType = "new_arc"')
  console.log('  - possibly arcImportance = "core"')
  console.log('  - possibly status != "archived"')
  console.log()
  const pickerCandidates = roots.filter((r) => r.status !== 'archived')
  console.log(`Matching roots (status != archived): ${pickerCandidates.length}`)
  for (const p of pickerCandidates) {
    console.log(`  ${p.id} | importance=${p.arcImportance} | status=${p.status} | "${p.arcLabel ?? p.headline.substring(0, 60)}"`)
  }
  const coreCandidates = pickerCandidates.filter((r) => r.arcImportance === 'core')
  console.log(`\nMatching roots (status != archived AND arcImportance = core): ${coreCandidates.length}`)
  for (const p of coreCandidates) {
    console.log(`  ${p.id} | "${p.arcLabel ?? p.headline.substring(0, 60)}"`)
  }

  console.log('\nLabel match against "' + HORMUZ_ARC_LABEL + '":')
  const exactLabelMatches = roots.filter((r) => r.arcLabel === HORMUZ_ARC_LABEL)
  console.log(`  Exact label matches among new_arc roots: ${exactLabelMatches.length}`)
  for (const e of exactLabelMatches) {
    console.log(`    ${e.id} | importance=${e.arcImportance} | status=${e.status}`)
  }
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
