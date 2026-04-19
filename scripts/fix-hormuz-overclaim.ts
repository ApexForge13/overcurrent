/**
 * Fix the repeat Hormuz kill:
 *   1. Set cluster.adminNotes to the standing editorial rule so every future
 *      analysis on this cluster is evaluated against it.
 *   2. Revise the Pattern sentence on the latest killed story to reflect
 *      the general-news vs specialist-press distinction (no "Zero" claims).
 *   3. Update the headline + synopsis to match the revised Pattern scope.
 *   4. Delete the unverifiable Johannes Peters claim.
 *   5. Fix the French/UK flag hallucination (vessels were Indian-flagged).
 *   6. Set story.status = 'review' and force-re-run quality review.
 *
 * Run: npx tsx scripts/fix-hormuz-overclaim.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import { runQualityReview } from '../src/lib/quality-review'

dotenvConfig({ override: true })

const STORY_ID = 'cmo675t6k003m12ooj7zuoxwr'
const CLUSTER_ID = 'cmo5efugm00c312pikkw7jsl4'

const CLUSTER_ADMIN_NOTE = `Pattern must specify general-news sources only — extensive insurance coverage exists in specialist press. Never claim zero coverage universally.`

const NEW_PATTERN = `The Strait of Hormuz crisis produced two functionally different stories in the coverage universe. General news led with ship strikes and US naval posture — 190+ of the 197 sources in this analysis framed the event as a military escalation. Specialist maritime and insurance press (Lloyd's List, S&P Global, NPR business desk, Globe and Mail, Insurance Business Mag, Argus Media, Asharq Al-Awsat) led with war-risk premium repricing, Lloyd's Joint War Committee redesignation, and P&I club cancellations. A reader consuming only general news missed the economic mechanism — insurance — that actually forces shipping to divert.`

const NEW_HEADLINE = `Iran Re-Closes Strait of Hormuz, Fires on Indian Tankers — General News Led with Naval Posture; Specialist Insurance Press Led with War-Risk Premium Repricing`

async function main() {
  console.log('\n━━━ HORMUZ OVERCLAIM FIX ━━━\n')

  // ── Step 1: Set the standing editorial note on the cluster ──────────
  await prisma.storyCluster.update({
    where: { id: CLUSTER_ID },
    data: { adminNotes: CLUSTER_ADMIN_NOTE },
  })
  console.log(`✓ Cluster ${CLUSTER_ID.substring(0, 8)} adminNotes set`)

  // ── Step 2: Load story + claims so we can target edits ─────────────
  const story = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: { id: true, status: true, headline: true, thePattern: true, synopsis: true },
  })
  if (!story) throw new Error(`Story ${STORY_ID} not found`)

  const claims = await prisma.claim.findMany({
    where: { storyId: STORY_ID },
    select: { id: true, claim: true, confidence: true, supportedBy: true, contradictedBy: true, status: true },
    orderBy: { sortOrder: 'asc' },
  })
  console.log(`✓ Loaded ${claims.length} claims`)

  // ── Step 3: Update Pattern + headline + synopsis scope ─────────────
  // Synopsis regex replacement: the "virtually no outlet reported" phrase
  // needs to narrow to "general-news outlets" and acknowledge specialist
  // press coverage.
  const SYNOPSIS_OVERCLAIM_RE = /(?:virtually no outlet|not a single outlet|no outlet in any region|zero outlets?)[^.]*\./i
  let newSynopsis = story.synopsis
  const match = SYNOPSIS_OVERCLAIM_RE.exec(story.synopsis)
  if (match) {
    const replacement = 'the insurance-market reaction surfaced in only a handful of general-news outlets (NPR, Globe and Mail, Asharq Al-Awsat, Insurance Business Mag). The bulk of general coverage framed the event around the military exchange, while specialist maritime and insurance press (Lloyd\'s List, S&P Global, Argus Media) covered war-risk premium repricing, P&I club cancellations, and Lloyd\'s Joint War Committee analysis in detail.'
    newSynopsis = story.synopsis.replace(SYNOPSIS_OVERCLAIM_RE, replacement)
    console.log(`✓ Synopsis overclaim phrase replaced — "${match[0].substring(0, 60)}..."`)
  } else {
    console.warn(`⚠️  Synopsis overclaim regex did not match. Pattern + headline will still be revised; synopsis may need manual edit if a 3rd run kills again.`)
  }

  await prisma.story.update({
    where: { id: STORY_ID },
    data: {
      thePattern: NEW_PATTERN,
      headline: NEW_HEADLINE,
      synopsis: newSynopsis,
      status: 'review',
    },
  })
  console.log(`✓ Story ${STORY_ID.substring(0, 8)}: new Pattern, headline, synopsis revised, status=review`)

  // ── Step 4: Delete the unverifiable Johannes Peters claim ──────────
  const petersClaims = claims.filter((c) =>
    c.claim.toLowerCase().includes('johannes peters') ||
    c.claim.toLowerCase().includes('kiel university') ||
    c.claim.toLowerCase().includes('aren\'t even certain that there are mines'),
  )
  if (petersClaims.length > 0) {
    const ids = petersClaims.map((c) => c.id)
    await prisma.claim.deleteMany({ where: { id: { in: ids } } })
    console.log(`✓ Deleted ${petersClaims.length} Johannes Peters claim(s) (unverifiable attribution)`)
    for (const c of petersClaims) {
      console.log(`    DELETED: "${c.claim.substring(0, 100)}${c.claim.length > 100 ? '...' : ''}"`)
    }
  } else {
    console.log('ℹ  No Johannes Peters claim found — already removed or never present')
  }

  // ── Step 5: Fix the French/UK flag hallucination ────────────────────
  // Find any claim mentioning French-flagged / UK-flagged vessels and either
  // delete or correct to Indian-flagged (per multi-source consensus).
  const flagClaims = claims.filter((c) => {
    const t = c.claim.toLowerCase()
    return (
      (t.includes('french') && (t.includes('flag') || t.includes('vessel') || t.includes('ship'))) ||
      (t.includes('uk-flagged') || t.includes('british-flagged') || t.includes('u.k.-flagged')) ||
      (t.includes('french and uk') || t.includes('french- and uk-'))
    )
  })
  for (const c of flagClaims) {
    if (c.claim.toLowerCase().includes('indian')) {
      // Already corrected — skip
      continue
    }
    const corrected = c.claim
      .replace(/French-?\s*and\s*UK-?flagged/gi, 'Indian-flagged')
      .replace(/French-flagged(?:\s+and\s+UK-flagged)?/gi, 'Indian-flagged')
      .replace(/UK-flagged(?:\s+and\s+French-flagged)?/gi, 'Indian-flagged')
      .replace(/French\s+and\s+UK/gi, 'Indian')
      .replace(/French\s+or\s+UK/gi, 'Indian')
    // If the regex above didn't actually change anything, delete rather than
    // leave a misattribution sitting in the record.
    if (corrected === c.claim) {
      await prisma.claim.delete({ where: { id: c.id } })
      console.log(`✓ Deleted French/UK flag claim (regex did not localize, unsafe to edit in place): "${c.claim.substring(0, 100)}..."`)
    } else {
      await prisma.claim.update({
        where: { id: c.id },
        data: {
          claim: corrected,
          confidence: 'HIGH',
          supportedBy: 'AP, Reuters, CNN, PBS, CBS News, CNBC, Axios (Indian-flagged vessels per multi-source consensus)',
          contradictedBy: '',
          notes: 'Corrected from French/UK flag hallucination per quality review kill card cmo67d01q00mp12oowf8r3vsz',
        },
      })
      console.log(`✓ Corrected flag attribution to Indian: "${corrected.substring(0, 100)}..."`)
    }
  }
  if (flagClaims.length === 0) {
    console.log('ℹ  No French/UK flag claim found in this story — may have been corrected upstream')
  }

  // ── Step 6: Force re-review ─────────────────────────────────────────
  console.log('\nRunning runQualityReview(force: true)…')
  const result = await runQualityReview(STORY_ID, { force: true })
  if (!result) {
    console.error('✗ runQualityReview returned null — check logs')
  } else {
    console.log(`\n━━━ NEW VERDICT ━━━`)
    console.log(`  overallRecommendation: ${result.overallRecommendation}`)
    console.log(`  patternVerified:       ${result.patternVerified}`)
    console.log(`  editorialScores:       ${JSON.stringify(result.editorialScores)}`)
    console.log(`  sensitivityFlags:      ${JSON.stringify(result.sensitivityFlags)}`)
    console.log(`  webSearchesRun:        ${result.webSearchesRun}`)
    console.log(`  reviewCost:            $${result.reviewCost.toFixed(3)}`)
    console.log(`  reviewDurationSec:     ${result.reviewDurationSeconds}`)
    console.log(`  autoArchived:          ${result.autoArchived}`)
    if (result.killReason) console.log(`  killReason:            ${result.killReason}`)
    if (result.suggestedEdits) {
      console.log(`  suggestedEdits:`)
      console.log(`    ${result.suggestedEdits}`)
    }
    console.log(`  qualityReviewCardId:   ${result.qualityReviewCardId}`)
  }

  // ── Step 7: Final state snapshot ─────────────────────────────────
  const final = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: {
      status: true,
      qualityReviewCards: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, overallRecommendation: true, createdAt: true },
      },
    },
  })
  const finalClaims = await prisma.claim.count({ where: { storyId: STORY_ID } })
  console.log(`\n━━━ FINAL STATE ━━━`)
  console.log(`  status:       ${final?.status}`)
  console.log(`  claims:       ${finalClaims}`)
  console.log(`  review cards: ${final?.qualityReviewCards.length ?? 0}`)
  for (const c of final?.qualityReviewCards ?? []) {
    console.log(`    ${c.id} | ${c.overallRecommendation} | ${c.createdAt.toISOString()}`)
  }
  console.log()
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
