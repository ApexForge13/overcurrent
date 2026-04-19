/**
 * Read-only diagnostic: find recently killed stories + their QualityReviewCard state.
 *
 * Run: npx tsx scripts/investigate-killed-stories.ts
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'

async function main() {
  const killed = await prisma.story.findMany({
    where: {
      status: 'archived',
      qualityReviewCards: { some: { overallRecommendation: 'kill' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      slug: true,
      headline: true,
      synopsis: true,
      thePattern: true,
      signalCategory: true,
      storyPhase: true,
      analysisType: true,
      arcLabel: true,
      coordinatesJson: true,
      primaryCountry: true,
      storyClusterId: true,
      umbrellaArcId: true,
      sourceCount: true,
      createdAt: true,
      qualityReviewCards: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      storyCluster: {
        select: {
          id: true,
          clusterHeadline: true,
          signalCategory: true,
          canonicalSignalCategory: true,
          currentPhase: true,
          firstDetectedAt: true,
        },
      },
      umbrellaArc: {
        select: { id: true, name: true, signalCategory: true },
      },
    },
  })

  console.log(`\n━━━ RECENTLY KILLED STORIES (${killed.length}) ━━━\n`)

  for (const s of killed) {
    const card = s.qualityReviewCards[0]
    console.log('═'.repeat(80))
    console.log(`Story: ${s.id}`)
    console.log(`Slug:  ${s.slug}`)
    console.log(`Created: ${s.createdAt.toISOString()}`)
    console.log(`Phase: ${s.storyPhase ?? '—'}  |  Type: ${s.analysisType ?? '—'}  |  Category: ${s.signalCategory ?? '—'}`)
    console.log(`Umbrella: ${s.umbrellaArc?.name ?? '—'} (${s.umbrellaArcId ?? 'null'})`)
    console.log(`Cluster: ${s.storyClusterId ?? '—'}  [phase=${s.storyCluster?.currentPhase ?? '—'}]`)
    if (s.storyCluster) {
      console.log(`Cluster headline: ${s.storyCluster.clusterHeadline}`)
    }
    console.log(`Arc label: ${s.arcLabel ?? '—'}`)
    console.log(`Source count: ${s.sourceCount}`)
    console.log()
    console.log(`Headline: ${s.headline}`)
    console.log()
    console.log(`Synopsis (first 400 chars):`)
    console.log(`  ${(s.synopsis ?? '').substring(0, 400)}${(s.synopsis ?? '').length > 400 ? '…' : ''}`)
    console.log()
    console.log(`Pattern:`)
    console.log(`  ${s.thePattern ?? '(null)'}`)
    console.log()
    console.log(`Phase 2 field verification:`)
    console.log(`  coordinatesJson: ${s.coordinatesJson ? JSON.stringify(s.coordinatesJson) : 'null ← Phase 2 did NOT populate'}`)
    console.log(`  primaryCountry:  ${s.primaryCountry ?? 'null ← Phase 2 did NOT populate'}`)
    if (card) {
      console.log()
      console.log(`Kill card (${card.id}) created: ${card.createdAt.toISOString()}`)
      console.log(`  overallRecommendation: ${card.overallRecommendation}`)
      console.log(`  patternVerified: ${card.patternVerified}`)
      console.log(`  patternStressTestDetail:`)
      console.log(`    ${card.patternStressTestDetail}`)
      console.log(`  editorialScores: ${JSON.stringify(card.editorialScores)}`)
      console.log(`  sensitivityFlags: ${JSON.stringify(card.sensitivityFlags)}`)
      console.log(`  suggestedEdits: ${card.suggestedEdits ?? '(null)'}`)
      console.log(`  verificationSummary: ${JSON.stringify(card.verificationSummary, null, 2)}`)
      console.log(`  webSearchesRun: ${card.webSearchesRun}`)
      console.log(`  reviewCost: $${card.reviewCost.toFixed(3)}`)
      console.log(`  reviewDurationSeconds: ${card.reviewDurationSeconds}`)
    }
    console.log()
  }

  if (killed.length === 0) {
    console.log('No killed stories found.')
    return
  }

  console.log('═'.repeat(80))
  console.log('\nTo act on a specific story, use its id above.\n')
}

main()
  .catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
