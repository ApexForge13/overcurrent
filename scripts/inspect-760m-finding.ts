/**
 * Pull all available data on the $760M Brent futures selloff finding so we
 * can draft a CaseStudyEntry about it. The finding lives in story cmo5gj5p6
 * (Hormuz cluster v2 consolidation, review status).
 *
 * Inspect: the claim itself, buried-evidence entry in confidenceNote,
 * propagation map / fact survival JSON, source registry entry for Insight,
 * debate rounds where the claim was discussed.
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const STORY_ID = 'cmo5gj5p6003o11pl7mpl0fs1'

async function main() {
  console.log('\n━━━ $760M FINDING — full data dump ━━━\n')

  const story = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: {
      id: true, status: true, headline: true, thePattern: true, synopsis: true,
      confidenceLevel: true, confidenceNote: true, sourceCount: true, createdAt: true, publishedAt: true,
      storyClusterId: true, umbrellaArcId: true,
      claims: { select: { sortOrder: true, claim: true, confidence: true, supportedBy: true, contradictedBy: true, notes: true }, orderBy: { sortOrder: 'asc' } },
      sources: { select: { url: true, title: true, outlet: true, country: true, region: true, publishedAt: true }, where: { OR: [
        { outlet: { contains: 'Insight', mode: 'insensitive' } },
        { outlet: { contains: 'CFTC', mode: 'insensitive' } },
        { url: { contains: 'insight', mode: 'insensitive' } },
      ] } },
    },
  })
  if (!story) { console.log('story not found'); return }

  console.log(`STORY: ${story.id}`)
  console.log(`  status:      ${story.status}`)
  console.log(`  publishedAt: ${story.publishedAt?.toISOString() ?? '(not published)'}`)
  console.log(`  cluster:     ${story.storyClusterId}`)
  console.log(`  umbrella:    ${story.umbrellaArcId}`)
  console.log(`  headline:    ${story.headline}`)
  console.log(`  thePattern:  ${story.thePattern}`)
  console.log(`  sourceCount: ${story.sourceCount}`)

  // The claim
  console.log(`\n━━━ THE CLAIM (sortOrder=14) ━━━\n`)
  const claim14 = story.claims.find((c) => c.sortOrder === 14)
  if (claim14) {
    console.log(`  claim:        ${claim14.claim}`)
    console.log(`  confidence:   ${claim14.confidence}`)
    console.log(`  supportedBy:  ${claim14.supportedBy}`)
    console.log(`  contradictedBy: ${claim14.contradictedBy}`)
    if (claim14.notes) console.log(`  notes:        ${claim14.notes}`)
  } else {
    console.log('  (sortOrder=14 not found)')
  }

  // The buried evidence (in confidenceNote JSON)
  console.log(`\n━━━ BURIED EVIDENCE entry for $760M ━━━\n`)
  const cn: { note?: string; buriedEvidence?: Array<Record<string, unknown>>; factSurvival?: Array<Record<string, unknown>> } =
    story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
  const buried760 = (cn.buriedEvidence ?? []).find((e) => {
    const fact = String(e.fact ?? '')
    return fact.includes('760') || fact.toLowerCase().includes('selloff') || fact.toLowerCase().includes('brent futures')
  })
  if (buried760) {
    console.log(JSON.stringify(buried760, null, 2))
  } else {
    console.log('  (no $760M-related buried evidence found in confidenceNote)')
  }

  // Fact survival entry, if present
  console.log(`\n━━━ FACT SURVIVAL entry for $760M ━━━\n`)
  const fs760 = (cn.factSurvival ?? []).find((e) => {
    const fact = String(e.fact ?? '')
    return fact.includes('760') || fact.toLowerCase().includes('selloff') || fact.toLowerCase().includes('brent futures')
  })
  if (fs760) {
    console.log(JSON.stringify(fs760, null, 2))
  } else {
    console.log('  (no fact-survival entry on $760M)')
  }

  // Source registry — Insight outlet
  console.log(`\n━━━ Insight (Korea) sources in this story ━━━\n`)
  for (const s of story.sources) {
    console.log(`  url:        ${s.url}`)
    console.log(`  title:      ${s.title}`)
    console.log(`  outlet:     ${s.outlet}`)
    console.log(`  country:    ${s.country}, region: ${s.region}`)
    console.log(`  publishedAt: ${s.publishedAt?.toISOString() ?? '(unknown)'}`)
    console.log()
  }

  // Cluster admin notes (the binding standing rule)
  if (story.storyClusterId) {
    const cluster = await prisma.storyCluster.findUnique({
      where: { id: story.storyClusterId },
      select: { adminNotes: true, currentPhase: true },
    })
    console.log(`\n━━━ Cluster context ━━━`)
    console.log(`  currentPhase: ${cluster?.currentPhase}`)
    console.log(`  adminNotes:   ${cluster?.adminNotes ? cluster.adminNotes.substring(0, 200) + '...' : '(none)'}`)
  }

  console.log()
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
