/**
 * Naval blockade story (cmnyb2e3z…) — Pattern + freshness pass.
 *
 *   1. Write a defensible Pattern grounded in claim 6 (UK/France refusal to
 *      join the blockade + Macron's announcement of a separate freedom-of-
 *      navigation mission). HIGH confidence, multi-sourced across NPR, Globe
 *      and Mail, RTE, Reuters wire (Daily Maverick / The Citizen), Bild, and
 *      Kathmandu Post. Specific, surprising, doesn't make a single absence-
 *      of-coverage claim — survives the three failure modes that killed the
 *      Hormuz revisions.
 *
 *   2. Prepend a FRESHNESS UPDATE block to the synopsis with the reviewer-
 *      verified developments through 2026-04-19 (Iran reopen-then-reclose,
 *      IRGC firing on India-flagged tankers, US-Iran second round declined,
 *      ceasefire expiry).
 *
 *   3. Set status='review' and force-rerun runQualityReview.
 *
 * Run: npx tsx scripts/finish-naval-blockade.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import { runQualityReview } from '../src/lib/quality-review'

dotenvConfig({ override: true })

const STORY_ID = 'cmnyb2e3z0026movrqvv557s9'

const NEW_PATTERN = `Britain and France refused to join the U.S. naval blockade of Iran. France's Macron announced — publicly, on day one — that London and Paris would instead organize their own "peaceful multinational mission aimed at restoring freedom of navigation." A US-NATO operational split during an active Middle East escalation, declared by name and not by inference, is the structural finding.`

const FRESHNESS_PREFIX = `FRESHNESS UPDATE (through 2026-04-19): Since publication on April 14, Iran briefly reopened the Strait on April 17 then re-closed it on April 18, with IRGC gunboats firing on India-flagged tankers and an unknown projectile striking a container vessel per UKMTO. A US-Iran second round of talks announced for April 20 was declined by Iran. The two-week ceasefire is set to expire on or about April 22. The "diplomatic channels remain open" and "oil prices easing" conclusions in this analysis pre-date these developments.

`

async function main() {
  console.log('\n━━━ NAVAL BLOCKADE — Pattern + Freshness ━━━\n')

  const story = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: { id: true, status: true, thePattern: true, synopsis: true },
  })
  if (!story) throw new Error('Naval blockade story not found')

  console.log(`  current status:  ${story.status}`)
  console.log(`  current Pattern: ${story.thePattern ?? '(none)'}`)

  if (story.thePattern) {
    throw new Error(`Naval blockade already has a Pattern — refusing to overwrite without explicit instruction. Current: "${story.thePattern}"`)
  }
  if (story.synopsis.startsWith('FRESHNESS UPDATE')) {
    throw new Error(`Naval blockade synopsis already begins with "FRESHNESS UPDATE" — refusing to double-prepend.`)
  }

  const newSynopsis = FRESHNESS_PREFIX + story.synopsis

  await prisma.story.update({
    where: { id: STORY_ID },
    data: { thePattern: NEW_PATTERN, synopsis: newSynopsis, status: 'review' },
  })
  console.log(`  ✓ Pattern written, freshness prefix prepended, status=review`)

  console.log(`\n  Running runQualityReview(force:true)…`)
  const r = await runQualityReview(STORY_ID, { force: true })
  if (!r) {
    console.log(`  ✗ runQualityReview returned null — see logs`)
    return
  }
  console.log(`\n  ━━━ VERDICT ━━━`)
  console.log(`  overallRecommendation: ${r.overallRecommendation.toUpperCase()}`)
  console.log(`  patternVerified:       ${r.patternVerified}`)
  console.log(`  editorialScores:       ${JSON.stringify(r.editorialScores)}`)
  console.log(`  sensitivityFlags:      ${JSON.stringify(r.sensitivityFlags)}`)
  console.log(`  webSearchesRun:        ${r.webSearchesRun}`)
  console.log(`  reviewCost:            $${r.reviewCost.toFixed(3)}`)
  console.log(`  reviewDurationSec:     ${r.reviewDurationSeconds}`)
  console.log(`  autoArchived:          ${r.autoArchived}`)
  if (r.killReason) console.log(`  killReason:            ${r.killReason}`)
  if (r.suggestedEdits) console.log(`  suggestedEdits:\n    ${r.suggestedEdits.replace(/\n/g, '\n    ')}`)
  console.log(`  qualityReviewCardId:   ${r.qualityReviewCardId}`)

  const finalStory = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: { status: true },
  })
  console.log(`\n  final story status:    ${finalStory?.status}`)
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
