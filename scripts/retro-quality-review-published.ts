/**
 * Retroactive quality review on all currently published stories.
 *
 * Loads every Story with status='published', then calls
 * runQualityReview(id, { force: true }) on each. Prints the verdict for each
 * story. Stories that come back as 'kill' will be auto-archived by the
 * reviewer (status -> 'archived'); see lib/quality-review.ts.
 *
 * Run: npx tsx scripts/retro-quality-review-published.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import { runQualityReview } from '../src/lib/quality-review'

// Force-override env so dotenv replaces shell-level empty ANTHROPIC_API_KEY.
dotenvConfig({ override: true })

async function main() {
  console.log('\n━━━ RETROACTIVE QUALITY REVIEW: PUBLISHED STORIES ━━━\n')

  const published = await prisma.story.findMany({
    where: { status: 'published' },
    select: {
      id: true,
      headline: true,
      thePattern: true,
      publishedAt: true,
      createdAt: true,
    },
    orderBy: { publishedAt: 'desc' },
  })

  console.log(`Found ${published.length} published stor${published.length === 1 ? 'y' : 'ies'}.\n`)

  if (published.length === 0) {
    console.log('Nothing to review.')
    return
  }

  for (const s of published) {
    console.log(`  ${s.id}`)
    console.log(`    headline:    ${s.headline.substring(0, 110)}${s.headline.length > 110 ? '…' : ''}`)
    console.log(`    publishedAt: ${s.publishedAt?.toISOString() ?? '(null)'}`)
    console.log()
  }

  console.log('━━━ RUNNING REVIEWS ━━━\n')

  const results: Array<{
    id: string
    headline: string
    verdict: string
    patternVerified: boolean | null
    scores: object | null
    flags: object | null
    killReason: string | null
    suggestedEdits: string | null
    cost: number | null
    durationSec: number | null
    webSearches: number | null
    autoArchived: boolean | null
    error?: string
  }> = []

  for (const s of published) {
    console.log(`▶ Reviewing ${s.id.substring(0, 12)}… (${s.headline.substring(0, 70)}${s.headline.length > 70 ? '…' : ''})`)
    try {
      const r = await runQualityReview(s.id, { force: true })
      if (!r) {
        console.log(`  ✗ runQualityReview returned null`)
        results.push({
          id: s.id, headline: s.headline, verdict: 'NULL_RETURN',
          patternVerified: null, scores: null, flags: null,
          killReason: null, suggestedEdits: null, cost: null,
          durationSec: null, webSearches: null, autoArchived: null,
          error: 'runQualityReview returned null — see logs above',
        })
      } else {
        console.log(`  → ${r.overallRecommendation.toUpperCase()} | patternVerified=${r.patternVerified} | $${r.reviewCost.toFixed(3)} | ${r.reviewDurationSeconds}s | ${r.webSearchesRun} searches${r.autoArchived ? ' | AUTO-ARCHIVED' : ''}`)
        results.push({
          id: s.id, headline: s.headline,
          verdict: r.overallRecommendation,
          patternVerified: r.patternVerified,
          scores: r.editorialScores,
          flags: r.sensitivityFlags,
          killReason: r.killReason,
          suggestedEdits: r.suggestedEdits,
          cost: r.reviewCost,
          durationSec: r.reviewDurationSeconds,
          webSearches: r.webSearchesRun,
          autoArchived: r.autoArchived,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ✗ ERROR: ${msg}`)
      results.push({
        id: s.id, headline: s.headline, verdict: 'ERROR',
        patternVerified: null, scores: null, flags: null,
        killReason: null, suggestedEdits: null, cost: null,
        durationSec: null, webSearches: null, autoArchived: null,
        error: msg,
      })
    }
    console.log()
  }

  console.log('━━━ SUMMARY ━━━\n')
  for (const r of results) {
    console.log(`  ${r.id}`)
    console.log(`    headline:    ${r.headline.substring(0, 110)}${r.headline.length > 110 ? '…' : ''}`)
    console.log(`    verdict:     ${r.verdict}`)
    if (r.error) {
      console.log(`    error:       ${r.error}`)
    } else {
      console.log(`    patternVerified: ${r.patternVerified}`)
      console.log(`    scores:      ${JSON.stringify(r.scores)}`)
      console.log(`    flags:       ${JSON.stringify(r.flags)}`)
      console.log(`    cost:        $${r.cost?.toFixed(3)} | ${r.durationSec}s | ${r.webSearches} web searches`)
      console.log(`    autoArchived: ${r.autoArchived}`)
      if (r.killReason) console.log(`    killReason:  ${r.killReason}`)
      if (r.suggestedEdits) console.log(`    suggestedEdits:\n      ${r.suggestedEdits.replace(/\n/g, '\n      ')}`)
    }
    console.log()
  }

  const totals = results.reduce(
    (acc, r) => {
      if (r.cost) acc.cost += r.cost
      if (r.durationSec) acc.duration += r.durationSec
      if (r.webSearches) acc.searches += r.webSearches
      return acc
    },
    { cost: 0, duration: 0, searches: 0 },
  )
  console.log(`  ── totals ──`)
  console.log(`    reviews run:    ${results.length}`)
  console.log(`    total cost:     $${totals.cost.toFixed(3)}`)
  console.log(`    total duration: ${totals.duration}s`)
  console.log(`    total searches: ${totals.searches}`)
  console.log()
}

main()
  .catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
