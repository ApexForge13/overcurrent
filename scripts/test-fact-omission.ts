/**
 * Test harness for fact-omission detection.
 *
 * Pulls sources from an existing Hungary or Iran analysis and runs the
 * fact-omission Haiku call against them. Validates:
 *   1. Haiku returns parseable JSON
 *   2. Returned omissions have valid factType values
 *   3. carriedByOutlets + missedByOutlets reference real domains
 *   4. Cost is within expected range (~$0.02-0.05)
 *
 * Run: npx tsx scripts/test-fact-omission.ts [slug]
 * Default slug is the latest published story with >= 5 sources.
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { detectFactOmissions, FACT_TYPES } from '../src/lib/signal/fact-omission'
import { normalizeDomain } from '../src/lib/outlet-map'

async function main() {
  const arg = process.argv[2]
  let story

  if (arg) {
    story = await prisma.story.findUnique({
      where: { slug: arg },
      include: { sources: true },
    })
  } else {
    story = await prisma.story.findFirst({
      where: { status: 'published' },
      orderBy: { createdAt: 'desc' },
      include: { sources: true },
    })
  }

  if (!story) {
    console.error('No story found. Pass a slug as argument.')
    process.exit(1)
  }

  console.log(`\n━━━ Fact-Omission Test Harness ━━━`)
  console.log(`Story: ${story.headline}`)
  console.log(`Slug: ${story.slug}`)
  console.log(`Source count: ${story.sources.length}`)

  // The production pipeline passes substantiveArticles (with content).
  // For this test, we don't have content stored in Source — the fetched content
  // is discarded after the debate. So this test validates the Haiku call shape
  // using source titles only, with synthetic content from the title.
  //
  // NOTE: Real production has full article bodies, so omission detection
  // quality in production will be higher than what this test demonstrates.
  const testSources = story.sources.slice(0, 10).map((s) => ({
    outletDomain: normalizeDomain(new URL(s.url).hostname),
    title: s.title,
    // Synthetic content: the title repeated + outlet + region info
    // This is a weak proxy but tests the JSON shape + outlet handling
    content: `${s.title}\n\nReported by ${s.outlet} (${s.region}). Coverage from ${s.country}. Published ${s.publishedAt?.toISOString() || 'recently'}.\n\nThis article discusses the events surrounding: ${story.headline}. Context: ${story.synopsis.substring(0, 500)}`,
  }))

  console.log(`Testing with ${testSources.length} sources (synthetic content — real pipeline uses full article bodies)\n`)
  console.log('Calling detectFactOmissions...\n')

  const startTime = Date.now()
  const result = await detectFactOmissions({
    sources: testSources,
    storyHeadline: story.headline,
  })
  const elapsed = Date.now() - startTime

  console.log(`━━━ Results ━━━`)
  console.log(`Elapsed: ${elapsed}ms`)
  console.log(`Cost: $${result.costUsd.toFixed(4)}`)
  console.log(`Skipped: ${result.skipped}`)
  if (result.skipReason) console.log(`Skip reason: ${result.skipReason}`)
  console.log(`Sources analyzed: ${result.sourcesAnalyzed}`)
  console.log(`Omissions detected: ${result.omissions.length}\n`)

  // Validation
  let validationIssues = 0
  for (let i = 0; i < result.omissions.length; i++) {
    const o = result.omissions[i]
    console.log(`Omission ${i + 1}:`)
    console.log(`  factType:        ${o.factType}`)
    console.log(`  factDescription: ${o.factDescription.substring(0, 120)}`)
    console.log(`  presentInPct:    ${o.presentInPct}`)
    console.log(`  carriedBy:       ${o.carriedByOutlets.join(', ')}`)
    console.log(`  missedBy:        ${o.missedByOutlets.join(', ')}`)

    // Validations
    if (!FACT_TYPES.includes(o.factType)) {
      console.log(`  ⚠ INVALID factType`)
      validationIssues++
    }
    if (o.presentInPct < 0 || o.presentInPct > 100) {
      console.log(`  ⚠ presentInPct out of range`)
      validationIssues++
    }
    if (o.carriedByOutlets.length === 0) {
      console.log(`  ⚠ no outlets in carriedByOutlets`)
      validationIssues++
    }
    if (o.missedByOutlets.length === 0) {
      console.log(`  ⚠ no outlets in missedByOutlets`)
      validationIssues++
    }
    // Check that carried/missed domains are in the input set
    const inputDomains = new Set(testSources.map((s) => s.outletDomain))
    const unknownCarried = o.carriedByOutlets.filter((d) => !inputDomains.has(d))
    const unknownMissed = o.missedByOutlets.filter((d) => !inputDomains.has(d))
    if (unknownCarried.length > 0) {
      console.log(`  ⚠ carriedByOutlets contains unknown domains: ${unknownCarried.join(', ')}`)
      validationIssues++
    }
    if (unknownMissed.length > 0) {
      console.log(`  ⚠ missedByOutlets contains unknown domains: ${unknownMissed.join(', ')}`)
      validationIssues++
    }
    console.log('')
  }

  console.log(`━━━ Validation ━━━`)
  console.log(`Issues found: ${validationIssues}`)

  // Cost check
  if (result.costUsd > 0.1) {
    console.log(`⚠ Cost higher than expected (>$0.10)`)
  } else if (result.costUsd > 0) {
    console.log(`✓ Cost within expected range ($${result.costUsd.toFixed(4)})`)
  }

  // JSON shape check
  if (!Array.isArray(result.omissions)) {
    console.log(`⚠ omissions is not an array`)
  } else {
    console.log(`✓ JSON shape valid (omissions is array of ${result.omissions.length} items)`)
  }

  console.log('')
  process.exit(validationIssues > 0 ? 1 : 0)
}

main().finally(() => prisma.$disconnect())
