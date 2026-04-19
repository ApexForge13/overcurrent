/**
 * Resubmit the Hormuz consolidation-phase analysis with a revised Pattern,
 * headline, and synopsis that matches the precise finding the quality agent
 * identified in its kill reasoning (general-news omission of insurance-
 * market reaction vs specialist-press coverage).
 *
 * Also creates the first CaseStudyEntry documenting the correction in five
 * sections: Original Pattern, What the Agent Found, Corrected Finding,
 * Why General-vs-Specialist Distinction IS the Finding, Enterprise Implication.
 *
 * Run once: npx tsx scripts/resubmit-hormuz.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import { runQualityReview } from '../src/lib/quality-review'

// Windows dev quirk: the shell has ANTHROPIC_API_KEY set to empty string,
// which dotenv refuses to override by default. Force-override so the SDK
// reads the real value from .env. Runs at script startup, before any
// Anthropic client is instantiated (client is now lazy inside runQualityReview).
dotenvConfig({ override: true })

const STORY_ID = 'cmo5gj5p6003o11pl7mpl0fs1'
const CLUSTER_ID = 'cmo5efugm00c312pikkw7jsl4'
const UMBRELLA_ID = 'cmo3f21ak000004l11k0vw7if'

const NEW_PATTERN = `282 general-news sources across 7 regions covered the Hormuz crisis; zero reported the insurance-market reaction. The specialist maritime press — Lloyd's List, S&P Global, Seatrade Maritime, Insurance Journal, and the Lloyd's Market Association — covered it extensively: war-risk premium figures, named underwriter quotes, formal market statements. The general-news reader and the specialist-press reader were looking at two functionally different stories about the same event.`

const NEW_HEADLINE = `Iran Re-Closes Strait of Hormuz, Fires on Indian Tankers — Insurance-Market Impact Covered by Specialist Press, Absent from General News`

// Regex captures the single-sentence overclaim. The replacement substitutes
// a three-sentence sequence that reframes the finding narrowly + correctly.
const SYNOPSIS_OLD_RE = /not a single outlet in any region[^.]*\./
const SYNOPSIS_REPLACEMENT = `among the 282 general-news sources in the analysis, not one reported the insurance-market reaction. Specialist maritime trade press — Lloyd's List, S&P Global, Seatrade Maritime, Insurance Journal — covered it extensively with war-risk premium figures and named underwriter quotes. The story general-news readers saw and the story specialist-press readers saw were functionally different.`

const CASE_STUDY_HEADLINE = `Hormuz: general news omits insurance-market reaction that specialist maritime press covered extensively`

const CASE_STUDY_DESCRIPTION = `## Original Pattern Claimed

The original Pattern read:

> "282 sources covered the Strait of Hormuz crisis. Zero — across all 7 regions — reported the insurance market reaction. The world's most important shipping chokepoint closed and no one asked what it costs to insure a tanker through it."

This asserted a universal editorial blind spot — that across every region covered by the 282 sources in the analysis, no outlet anywhere reported on insurance-market reactions to the Hormuz closure.

## What the Quality Agent Found

The quality review agent ran 7 web searches and identified substantial specialist-press coverage of exactly the topic the Pattern claimed was unreported:

- **Lloyd's List** — specific war-risk premium figures ($10–14M per voyage, 2.5%–5% of hull value for Hormuz transits), named underwriter quotes
- **Lloyd's Market Association** — formal market statement dated 23 March 2026
- **Lloyd's CEO Patrick Tiernan** — Bloomberg interview on market conditions
- **S&P Global** — 13 March 2026 article "Marine war insurance for Hormuz dries up"
- **Insurance Journal, Seatrade Maritime, IBTimes Australia** — extensive market coverage
- **US DFC–Chubb $20 billion reinsurance program** — publicly announced

The agent's kill reasoning itself identified the corrected framing: "The finding may be defensible as a narrow observation about the 282 general-news sources monitored (which likely excluded specialist maritime trade press), but the PATTERN sentence and headline assert a universal editorial blind spot that is factually false."

## Corrected Finding

The correct Pattern is narrower and more precise: the 282 general-news sources in the analysis did not report the insurance-market reaction, while specialist maritime trade press — Lloyd's List, S&P Global, Seatrade Maritime, Insurance Journal, and the Lloyd's Market Association — covered it extensively with named figures, named underwriters, and a formal market statement. The information was not absent from the world; it was absent from general-news coverage.

## Why the General-vs-Specialist Distinction IS the Most Important Finding

A reader consuming only general news — Reuters, AP, BBC, CNN, regional dailies, the 200+ outlets monitored — was systematically uninformed about a material dimension of the Hormuz event. A reader consuming specialist maritime/insurance press had access to specific premium figures, underwriter positioning, and formal market statements.

This is a precise, reproducible, and consequential gap:

1. It is not "no one covered the insurance angle" — that claim is false, as the quality agent showed.
2. It is not "the insurance angle was too esoteric to cover" — specialist press covered it with depth and named quotes.
3. It is that two coverage universes — general news and specialist trade — produced functionally different stories about the same event, and most readers only see one of them.

This is exactly the kind of divergence Overcurrent is built to identify. The product thesis is that consequential information gets trapped in silos: specialist press reaches operators and underwriters who make decisions on that information, while general press reaches everyone else. When a story has a material specialist-press dimension that general-news readers never see, the general-news audience is systematically under-informed in a way they cannot perceive.

The original Pattern overclaimed. The corrected Pattern is smaller, more accurate, and more valuable — because it names the actual structural gap (general press vs specialist press) that readers of general news need to know exists.

This correction, and the ability to document it transparently, is itself a demonstration of how the quality review agent functions as intended: it caught the overclaim, identified the more precise finding embedded in the overclaim, and gave us the vocabulary to describe the correct gap.

## Enterprise Implication

A trading desk reading general news had no visibility into the insurance market reaction that determines whether ships return to the strait. A trading desk with Overcurrent would have seen both streams simultaneously — the geopolitical narrative and the specialist market data — and understood the gap between them. This is the core product value demonstrated in a single story.`

async function main() {
  console.log('\n━━━ HORMUZ RESUBMIT ━━━\n')

  // ── Step 1: Load current state ────────────────────────────────────
  const story = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: {
      id: true, status: true, headline: true, thePattern: true,
      synopsis: true, storyClusterId: true, umbrellaArcId: true,
    },
  })
  if (!story) throw new Error(`Story ${STORY_ID} not found`)

  console.log(`Current status:   ${story.status}`)
  console.log(`Current headline: ${story.headline.substring(0, 100)}…`)
  console.log()
  console.log(`Current Pattern:`)
  console.log(`  ${story.thePattern}`)
  console.log()
  console.log(`Current synopsis (full text):`)
  console.log(story.synopsis.split('\n').map((l) => `  ${l}`).join('\n'))
  console.log()

  // ── Step 2: Compose new synopsis via regex replacement ────────────
  let newSynopsis = story.synopsis
  const match = SYNOPSIS_OLD_RE.exec(story.synopsis)
  if (match) {
    newSynopsis = story.synopsis.replace(SYNOPSIS_OLD_RE, SYNOPSIS_REPLACEMENT)
    console.log(`✓ Synopsis regex matched — replacing sentence:`)
    console.log(`    OLD: "${match[0]}"`)
    console.log(`    NEW: "${SYNOPSIS_REPLACEMENT}"`)
    console.log()
  } else {
    console.warn(`⚠️ Synopsis overclaim regex did not match — synopsis left unchanged.`)
    console.warn(`   Pattern + headline will still be revised; reviewer may still kill if synopsis carries same overclaim.`)
    console.log()
  }

  // ── Step 3: Update story ──────────────────────────────────────────
  await prisma.story.update({
    where: { id: STORY_ID },
    data: {
      thePattern: NEW_PATTERN,
      headline: NEW_HEADLINE,
      synopsis: newSynopsis,
      status: 'review',
    },
  })
  console.log(`✓ Story updated: new Pattern + headline, synopsis revised${match ? '' : ' (pattern+headline only)'}, status=review`)
  console.log()

  // ── Step 4: Force-run quality review ──────────────────────────────
  console.log(`Running runQualityReview(force: true)…`)
  const result = await runQualityReview(STORY_ID, { force: true })

  if (!result) {
    console.error(`✗ runQualityReview returned null — check server logs for the reason`)
    // Re-fetch story status so we know where we ended up
    const after = await prisma.story.findUnique({ where: { id: STORY_ID }, select: { status: true } })
    console.error(`  Post-call story status: ${after?.status}`)
  } else {
    console.log()
    console.log(`━━━ NEW QUALITY REVIEW VERDICT ━━━`)
    console.log(`  overallRecommendation: ${result.overallRecommendation}`)
    console.log(`  patternVerified:       ${result.patternVerified}`)
    console.log(`  editorialScores:       ${JSON.stringify(result.editorialScores)}`)
    console.log(`  sensitivityFlags:      ${JSON.stringify(result.sensitivityFlags)}`)
    console.log(`  webSearchesRun:        ${result.webSearchesRun}`)
    console.log(`  reviewCost:            $${result.reviewCost.toFixed(3)}`)
    console.log(`  reviewDurationSec:     ${result.reviewDurationSeconds}`)
    console.log(`  autoArchived:          ${result.autoArchived}`)
    if (result.killReason) console.log(`  killReason:            ${result.killReason}`)
    if (result.suggestedEdits) console.log(`  suggestedEdits:        ${result.suggestedEdits}`)
    console.log(`  qualityReviewCardId:   ${result.qualityReviewCardId}`)
    console.log()
  }

  // ── Step 5: Create the CaseStudyEntry ─────────────────────────────
  const existingCaseStudies = await prisma.caseStudyEntry.count({
    where: { storyClusterId: CLUSTER_ID, signalType: 'editorial_correction' },
  })
  if (existingCaseStudies > 0) {
    console.log(`ℹ️ ${existingCaseStudies} existing editorial_correction CaseStudyEntry on this cluster — skipping insert (idempotent)`)
  } else {
    const caseStudy = await prisma.caseStudyEntry.create({
      data: {
        rawSignalLayerId: null,
        storyClusterId: CLUSTER_ID,
        umbrellaArcId: UMBRELLA_ID,
        signalType: 'editorial_correction',
        headline: CASE_STUDY_HEADLINE,
        fullDescription: CASE_STUDY_DESCRIPTION,
        storyPhaseAtDetection: 'consolidation',
        divergenceType: 'narrative_omits_raw',
        isPublishable: false,
      },
    })
    console.log(`✓ CaseStudyEntry created: ${caseStudy.id}`)
    console.log(`  signalType:             ${caseStudy.signalType}`)
    console.log(`  divergenceType:         ${caseStudy.divergenceType}`)
    console.log(`  storyPhaseAtDetection:  ${caseStudy.storyPhaseAtDetection}`)
    console.log(`  isPublishable:          ${caseStudy.isPublishable}`)
    console.log()
  }

  // ── Step 6: Final state snapshot ──────────────────────────────────
  const final = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: {
      status: true, headline: true, thePattern: true, synopsis: true,
      qualityReviewCards: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  })
  console.log(`━━━ FINAL STATE ━━━`)
  console.log(`  status:       ${final?.status}`)
  console.log(`  review cards: ${final?.qualityReviewCards.length ?? 0}`)
  if (final?.qualityReviewCards.length) {
    console.log(`    Card history (newest first):`)
    for (const c of final.qualityReviewCards) {
      console.log(`      ${c.id} | ${c.overallRecommendation} | ${c.createdAt.toISOString()}`)
    }
  }
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
