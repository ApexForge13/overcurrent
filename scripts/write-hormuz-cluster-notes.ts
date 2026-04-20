/**
 * Write the hardened Standing Editorial Note to the Hormuz cluster
 * (cmo5efugm00c312pikkw7jsl4) after admin approval on 2026-04-19.
 *
 * Replaces the prior single-sentence note with a three-failure-mode
 * standing rule set: prohibits universal zero-coverage assertions,
 * specialist-press miscategorization, and absence claims that fail
 * a basic web search.
 *
 * The note is read by the quality review agent and injected into the
 * verdict prompt for every analysis under this cluster.
 *
 * Run: npx tsx scripts/write-hormuz-cluster-notes.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const HORMUZ_CLUSTER_ID = 'cmo5efugm00c312pikkw7jsl4'

const NEW_ADMIN_NOTES = `STANDING EDITORIAL NOTE — Hormuz / Strait of Hormuz cluster
Updated 2026-04-19 after two consecutive kill verdicts (cmo5gj5p6 consolidation v1, cmo675t6k consolidation v2) on different revisions of this cluster's central "insurance market gap" finding. Three failure modes are formally prohibited in any future analysis or revision under this cluster:

1. UNIVERSAL ZERO-COVERAGE ASSERTIONS PROHIBITED.
   Pattern, headline, synopsis, claims, and buried evidence must scope every absence claim to a defined source population — e.g. "across the 197 general-news sources in this analysis" or "across the 24 US wire/major-paper outlets monitored." Phrases like "general readers never saw," "no outlet anywhere reported," "the world's coverage missed," or any equivalent universal formulation are not allowed. Specialist maritime, insurance, and trade press (Lloyd's List, S&P Global, Argus Media, Insurance Journal, Lloyd's Market Association, Seatrade Maritime, Responsible Statecraft, etc.) cover this beat with depth; any analysis that asserts an absence without scoping to general-news will be killed.

2. SPECIALIST-PRESS MISCATEGORIZATION PROHIBITED.
   Before citing any outlet as "specialist insurance press," "specialist maritime trade press," or any equivalent specialist designation, verify the outlet's classification in the Outlet table (editorialType + tier fields). General-news outlets — including but not limited to The Globe and Mail, NPR, Asharq Al-Awsat, the Financial Times, the Washington Post, BBC, and Bloomberg — must NEVER be characterized as specialist press, even when one of their articles happens to cover an insurance angle. The specialist-vs-general distinction is the editorial finding for this cluster; getting the classification wrong inverts the finding.

3. ABSENCE CLAIMS MUST SURVIVE BASIC WEB SEARCH.
   Any single-sentence Pattern, headline assertion, or claim that asserts the absence of coverage on a specific topic must survive a basic web search on the exact claim before being written. If a 30-second web search surfaces general-news pieces on the topic the analysis claims is unreported, the absence claim is wrong and must be reframed. Both prior kills on this cluster failed this test — Responsible Statecraft, The National News, IBTimes Australia, Globe and Mail, Straight Arrow News, and WEF all surfaced under web search as general-audience pieces covering the war-risk insurance angle the analyses claimed was absent.`

async function main() {
  console.log('\n━━━ HORMUZ CLUSTER adminNotes WRITE ━━━\n')

  const before = await prisma.storyCluster.findUnique({
    where: { id: HORMUZ_CLUSTER_ID },
    select: { id: true, clusterHeadline: true, adminNotes: true },
  })
  if (!before) throw new Error('Hormuz cluster not found')

  console.log(`  cluster: ${before.id}`)
  console.log(`  headline: ${before.clusterHeadline}`)
  console.log(`\n  PRIOR adminNotes:`)
  console.log(`    ${before.adminNotes ?? '(null)'}`)
  console.log(`\n  NEW adminNotes length: ${NEW_ADMIN_NOTES.length} chars`)

  await prisma.storyCluster.update({
    where: { id: HORMUZ_CLUSTER_ID },
    data: { adminNotes: NEW_ADMIN_NOTES },
  })
  console.log(`\n  ✓ adminNotes updated`)

  const after = await prisma.storyCluster.findUnique({
    where: { id: HORMUZ_CLUSTER_ID },
    select: { adminNotes: true },
  })
  if (after?.adminNotes !== NEW_ADMIN_NOTES) {
    throw new Error('Verification failed — adminNotes does not match expected value after write')
  }
  console.log(`  ✓ Read-back verified — ${after.adminNotes.length} chars stored\n`)
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
