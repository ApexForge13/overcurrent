/**
 * Read-only inspection: pulls (1) the most recent QualityReviewCard for the
 * naval blockade story so we can show the hold reasoning, and (2) the full
 * current state (headline, Pattern, synopsis, status, claim/source counts,
 * cluster admin notes) of the four stories the user wants to modify.
 *
 * No writes. Run: npx tsx scripts/inspect-followup.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const NAVAL_BLOCKADE_ID = 'cmnyb2e3z0026movrqvv557s9'
const HORMUZ_ID = 'cmo675t6k003m12ooj7zuoxwr'
const HUNGARY_ID = 'cmo0z8d8n003koovr4jwbi9ca'
const TRUMP_CEASEFIRE_ID = 'cmo2cd81e003m12nmszpdacxn'
const SWALWELL_ID = 'cmo2pga5o003is0vruh98ui3e'

async function main() {
  console.log('\n━━━ NAVAL BLOCKADE — LATEST QUALITY REVIEW CARD ━━━\n')
  const naval = await prisma.qualityReviewCard.findFirst({
    where: { storyId: NAVAL_BLOCKADE_ID },
    orderBy: { createdAt: 'desc' },
  })
  if (!naval) {
    console.log('  (no review card found)')
  } else {
    console.log(`  cardId:                ${naval.id}`)
    console.log(`  createdAt:             ${naval.createdAt.toISOString()}`)
    console.log(`  overallRecommendation: ${naval.overallRecommendation}`)
    console.log(`  patternVerified:       ${naval.patternVerified}`)
    console.log(`  patternStressTestDetail:`)
    console.log(`    ${naval.patternStressTestDetail}`)
    console.log(`  editorialScores:       ${JSON.stringify(naval.editorialScores)}`)
    console.log(`  sensitivityFlags:      ${JSON.stringify(naval.sensitivityFlags, null, 2).split('\n').join('\n  ')}`)
    console.log(`  verificationSummary:   ${JSON.stringify(naval.verificationSummary, null, 2).split('\n').join('\n  ')}`)
    console.log(`  suggestedEdits:        ${naval.suggestedEdits ?? '(none)'}`)
    console.log(`  webSearchesRun:        ${naval.webSearchesRun}`)
    console.log(`  reviewCost:            $${naval.reviewCost.toFixed(3)}`)
  }

  for (const [label, id] of [
    ['HORMUZ', HORMUZ_ID],
    ['HUNGARY', HUNGARY_ID],
    ['TRUMP CEASEFIRE', TRUMP_CEASEFIRE_ID],
    ['SWALWELL', SWALWELL_ID],
  ] as const) {
    console.log(`\n\n━━━ ${label} (${id}) ━━━\n`)
    const story = await prisma.story.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        headline: true,
        thePattern: true,
        synopsis: true,
        confidenceLevel: true,
        confidenceNote: true,
        sourceCount: true,
        storyClusterId: true,
        umbrellaArcId: true,
        storyCluster: { select: { id: true, adminNotes: true } },
        claims: {
          select: { claim: true, confidence: true, supportedBy: true, contradictedBy: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    if (!story) {
      console.log('  (story not found)')
      continue
    }
    console.log(`  status:    ${story.status}`)
    console.log(`  cluster:   ${story.storyClusterId ?? '(none)'}`)
    console.log(`  umbrella:  ${story.umbrellaArcId ?? '(none)'}`)
    console.log(`  sourceCount: ${story.sourceCount}`)
    console.log(`  confidence: ${story.confidenceLevel}${story.confidenceNote ? ' — ' + story.confidenceNote : ''}`)
    console.log(`\n  HEADLINE:\n    ${story.headline}`)
    console.log(`\n  PATTERN:\n    ${story.thePattern ?? '(no Pattern)'}`)
    console.log(`\n  SYNOPSIS (full):`)
    console.log(story.synopsis.split('\n').map((l) => '    ' + l).join('\n'))
    console.log(`\n  CLAIMS (${story.claims.length}):`)
    for (const c of story.claims) {
      console.log(`    [${c.sortOrder}] (${c.confidence}) ${c.claim}`)
      if (c.supportedBy) console.log(`        supported by: ${c.supportedBy}`)
      if (c.contradictedBy) console.log(`        contradicted by: ${c.contradictedBy}`)
    }
    if (story.storyCluster?.adminNotes) {
      console.log(`\n  CLUSTER STANDING EDITORIAL NOTE:\n    ${story.storyCluster.adminNotes}`)
    }
  }

  console.log()
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
