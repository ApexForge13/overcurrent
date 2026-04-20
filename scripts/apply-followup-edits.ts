/**
 * Follow-up edits requested after the 2026-04-19 retroactive quality review:
 *
 *   1. HORMUZ (cmo675t6k…) — remove ", the Globe and Mail" from the Pattern's
 *      specialist-press list, set status='review', force-rerun quality review.
 *
 *   2. HUNGARY (cmo0z8d8n…) — clear the Pattern (the entire current Pattern is
 *      the unverifiable Yle/Miklóssy claim), delete claim sortOrder=14
 *      (Müller via La Repubblica), strip buried-evidence items 1 and 2 from
 *      confidenceNote (keep item 3 — SVT/Vance, verified), set status='review',
 *      force-rerun quality review.
 *
 *   3. TRUMP CEASEFIRE (cmo2cd81e…) — apply the Munir correction: replace the
 *      Munir sentence in the synopsis, flip claim sortOrder=13 from
 *      'unsubstantiated' (LOW) to multiply-confirmed (HIGH), and update the
 *      confidenceNote so 'Munir's specific message' is no longer in the
 *      unverified list. Story stays published — no quality re-review.
 *
 *   4. SWALWELL (cmo2pga5o…) — no text changes. Reviewer confirmed allegations
 *      and denials are accurately characterized; named-individual risk is
 *      inherent to the story's subject matter, not a hedging defect. Story
 *      stays published.
 *
 * Run: npx tsx scripts/apply-followup-edits.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import { runQualityReview } from '../src/lib/quality-review'

dotenvConfig({ override: true })

const HORMUZ_ID = 'cmo675t6k003m12ooj7zuoxwr'
const HUNGARY_ID = 'cmo0z8d8n003koovr4jwbi9ca'
const TRUMP_ID = 'cmo2cd81e003m12nmszpdacxn'
const SWALWELL_ID = 'cmo2pga5o003is0vruh98ui3e'

// ─────────────────────────────────────────────────────────────────────────
// Hormuz
// ─────────────────────────────────────────────────────────────────────────

async function fixHormuz() {
  console.log('\n━━━ HORMUZ ━━━')
  const story = await prisma.story.findUnique({
    where: { id: HORMUZ_ID },
    select: { id: true, status: true, thePattern: true },
  })
  if (!story) throw new Error('Hormuz story not found')

  console.log(`  current status:  ${story.status}`)
  console.log(`  current Pattern: ${story.thePattern}`)

  const oldFragment = `Lloyd's List, S&P Global, the Globe and Mail`
  const newFragment = `Lloyd's List, S&P Global`
  if (!story.thePattern || !story.thePattern.includes(oldFragment)) {
    throw new Error(
      `Hormuz Pattern does not contain the expected "${oldFragment}" fragment — refusing to edit blindly`,
    )
  }
  const newPattern = story.thePattern.replace(oldFragment, newFragment)
  console.log(`  new Pattern:     ${newPattern}`)

  await prisma.story.update({
    where: { id: HORMUZ_ID },
    data: { thePattern: newPattern, status: 'review' },
  })
  console.log(`  ✓ Pattern updated, status=review`)

  console.log(`\n  Running runQualityReview(force:true)…`)
  const r = await runQualityReview(HORMUZ_ID, { force: true })
  if (!r) {
    console.log(`  ✗ runQualityReview returned null`)
    return null
  }
  console.log(`  → ${r.overallRecommendation.toUpperCase()} | patternVerified=${r.patternVerified} | $${r.reviewCost.toFixed(3)} | ${r.reviewDurationSeconds}s | ${r.webSearchesRun} searches${r.autoArchived ? ' | AUTO-ARCHIVED' : ''}`)
  return r
}

// ─────────────────────────────────────────────────────────────────────────
// Hungary
// ─────────────────────────────────────────────────────────────────────────

async function fixHungary() {
  console.log('\n━━━ HUNGARY ━━━')
  const story = await prisma.story.findUnique({
    where: { id: HUNGARY_ID },
    select: {
      id: true,
      status: true,
      thePattern: true,
      confidenceNote: true,
      claims: { select: { id: true, sortOrder: true, claim: true, supportedBy: true }, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!story) throw new Error('Hungary story not found')

  console.log(`  current status:  ${story.status}`)
  console.log(`  current Pattern: ${story.thePattern?.substring(0, 100)}…`)

  // ── (1) Clear Pattern ─────────────────────────────────────────────
  if (!story.thePattern || !story.thePattern.toLowerCase().includes('miklóssy') &&
      !story.thePattern.toLowerCase().includes('miklossy') &&
      !story.thePattern.toLowerCase().includes('yle')) {
    throw new Error('Hungary Pattern does not contain expected Yle/Miklóssy reference — refusing to clear blindly')
  }

  // ── (2) Find and delete the Müller / La Repubblica claim ──────────
  const mullerClaim = story.claims.find(
    (c) => c.claim.includes('Müller') || c.claim.includes('Muller') || /la repubblica/i.test(c.supportedBy ?? ''),
  )
  if (!mullerClaim) {
    throw new Error('Could not find Müller/La Repubblica claim in Hungary story')
  }
  console.log(`  Müller claim to delete:`)
  console.log(`    [sortOrder=${mullerClaim.sortOrder}] ${mullerClaim.claim.substring(0, 100)}…`)
  console.log(`    supportedBy: ${mullerClaim.supportedBy}`)

  // ── (3) Parse confidenceNote, strip buried evidence items 1 & 2 ──
  if (!story.confidenceNote) {
    throw new Error('Hungary confidenceNote is empty — cannot strip buried evidence')
  }
  let confNote: { note?: string; buriedEvidence?: Array<Record<string, unknown>>; [k: string]: unknown }
  try {
    confNote = JSON.parse(story.confidenceNote)
  } catch (e) {
    throw new Error(`Could not parse Hungary confidenceNote as JSON: ${e instanceof Error ? e.message : e}`)
  }
  const evBefore = confNote.buriedEvidence ?? []
  console.log(`  buried evidence before: ${evBefore.length} items`)
  for (const e of evBefore) {
    const f = String(e.fact ?? '')
    console.log(`    sortOrder=${e.sortOrder} reportedBy=${e.reportedBy} : ${f.substring(0, 90)}…`)
  }
  const evAfter = evBefore.filter((e) => {
    const reportedBy = String(e.reportedBy ?? '').toLowerCase()
    const fact = String(e.fact ?? '').toLowerCase()
    if (reportedBy.includes('yle') || fact.includes('miklóssy') || fact.includes('miklossy')) {
      console.log(`    REMOVING (Yle/Miklóssy): sortOrder=${e.sortOrder}`)
      return false
    }
    if (reportedBy.includes('la repubblica') || fact.includes('müller') || fact.includes('muller')) {
      console.log(`    REMOVING (La Repubblica/Müller): sortOrder=${e.sortOrder}`)
      return false
    }
    return true
  })
  console.log(`  buried evidence after:  ${evAfter.length} items`)
  confNote.buriedEvidence = evAfter
  const newConfNote = JSON.stringify(confNote)

  // ── Apply all changes in a single transaction ─────────────────────
  await prisma.$transaction([
    prisma.claim.delete({ where: { id: mullerClaim.id } }),
    prisma.story.update({
      where: { id: HUNGARY_ID },
      data: { thePattern: null, confidenceNote: newConfNote, status: 'review' },
    }),
  ])
  console.log(`  ✓ Pattern cleared, claim sortOrder=${mullerClaim.sortOrder} deleted, buried evidence trimmed, status=review`)

  console.log(`\n  Running runQualityReview(force:true)…`)
  const r = await runQualityReview(HUNGARY_ID, { force: true })
  if (!r) {
    console.log(`  ✗ runQualityReview returned null`)
    return null
  }
  console.log(`  → ${r.overallRecommendation.toUpperCase()} | patternVerified=${r.patternVerified} | $${r.reviewCost.toFixed(3)} | ${r.reviewDurationSeconds}s | ${r.webSearchesRun} searches${r.autoArchived ? ' | AUTO-ARCHIVED' : ''}`)
  return r
}

// ─────────────────────────────────────────────────────────────────────────
// Trump ceasefire — Munir correction only, no quality re-review
// ─────────────────────────────────────────────────────────────────────────

async function fixTrumpMunir() {
  console.log('\n━━━ TRUMP CEASEFIRE — MUNIR CORRECTION ━━━')
  const story = await prisma.story.findUnique({
    where: { id: TRUMP_ID },
    select: {
      id: true,
      status: true,
      synopsis: true,
      confidenceNote: true,
      claims: { select: { id: true, sortOrder: true, claim: true, confidence: true, supportedBy: true }, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!story) throw new Error('Trump story not found')
  console.log(`  current status: ${story.status}`)

  // ── (1) Synopsis sentence replace ──────────────────────────────────
  const oldSynopsisFragment = `Pakistan's army chief Asim Munir met Iranian officials in Tehran, but whether he carried a specific US nuclear message remains unsubstantiated in available texts.`
  const newSynopsisFragment = `Pakistan's army chief Asim Munir met Iranian President Pezeshkian and Parliament Speaker Ghalibaf in Tehran and carried a specific US message on the Iran nuclear file — confirmed by CNN, Al Jazeera, Press TV, and Iranian state media (verified by quality review on 2026-04-19).`
  if (!story.synopsis.includes(oldSynopsisFragment)) {
    throw new Error(
      'Trump synopsis does not contain expected Munir sentence verbatim — refusing to edit blindly. Inspect manually.',
    )
  }
  const newSynopsis = story.synopsis.replace(oldSynopsisFragment, newSynopsisFragment)
  console.log(`  ✓ Synopsis Munir sentence located`)

  // ── (2) Find claim 13 (Munir-message claim) ────────────────────────
  const munirClaim = story.claims.find(
    (c) => c.claim.includes('Munir carried a specific US message') ||
           c.claim.includes('Whether Munir carried'),
  )
  if (!munirClaim) {
    throw new Error('Could not find Munir-message claim in Trump story')
  }
  console.log(`  Munir claim to update:`)
  console.log(`    [sortOrder=${munirClaim.sortOrder}] (${munirClaim.confidence}) ${munirClaim.claim.substring(0, 100)}…`)

  const newClaimText = `Pakistan Army Chief Field Marshal Asim Munir carried a specific US message on the Iran nuclear file to Tehran during his three-day visit, meeting Iranian President Pezeshkian and Parliament Speaker Ghalibaf. The US-message-carrying role is multiply confirmed by CNN, Al Jazeera, Press TV, and Iranian state media.`
  const newSupportedBy = `${munirClaim.supportedBy ? munirClaim.supportedBy + '; ' : ''}CNN, Al Jazeera, Press TV, Iranian state media (multi-source consensus per quality review verification 2026-04-19)`

  // ── (3) Confidence note: remove Munir from unverified list ──────────
  if (!story.confidenceNote) {
    throw new Error('Trump confidenceNote is empty')
  }
  let confNote: { note?: string; [k: string]: unknown }
  try { confNote = JSON.parse(story.confidenceNote) } catch (e) {
    throw new Error(`Could not parse Trump confidenceNote as JSON: ${e instanceof Error ? e.message : e}`)
  }
  const oldNote = confNote.note ?? ''
  const oldNoteFragment = `the three highest-stakes claims — Iran's nuclear agreement, the Aoun-Netanyahu non-call, and Munir's specific message — each rely on single anonymous or unverified sourcing chains.`
  const newNoteFragment = `two of the highest-stakes claims — Iran's nuclear agreement and the Aoun-Netanyahu non-call — rely on single anonymous or unverified sourcing chains. The third (Munir's US-message role) was independently verified post-publication via CNN, Al Jazeera, Press TV, and Iranian state media.`
  let newNote = oldNote
  if (oldNote.includes(oldNoteFragment)) {
    newNote = oldNote.replace(oldNoteFragment, newNoteFragment)
    console.log(`  ✓ confidenceNote.note Munir reference located and updated`)
  } else {
    console.warn(`  ⚠ confidenceNote.note did not contain expected verbatim Munir fragment — leaving note unchanged`)
  }
  confNote.note = newNote
  const newConfidenceNote = JSON.stringify(confNote)

  await prisma.$transaction([
    prisma.story.update({
      where: { id: TRUMP_ID },
      data: { synopsis: newSynopsis, confidenceNote: newConfidenceNote },
    }),
    prisma.claim.update({
      where: { id: munirClaim.id },
      data: { claim: newClaimText, confidence: 'HIGH', supportedBy: newSupportedBy },
    }),
  ])
  console.log(`  ✓ Trump synopsis + Munir claim + confidence note updated; status remains ${story.status}`)
}

// ─────────────────────────────────────────────────────────────────────────
// Swalwell — confirm published, no edits
// ─────────────────────────────────────────────────────────────────────────

async function approveSwalwell() {
  console.log('\n━━━ SWALWELL — REVIEW HEDGING ━━━')
  const story = await prisma.story.findUnique({
    where: { id: SWALWELL_ID },
    select: { id: true, status: true, headline: true, synopsis: true },
  })
  if (!story) throw new Error('Swalwell story not found')
  console.log(`  status: ${story.status}`)
  console.log(`\n  Hedging review:`)
  console.log(`  - Synopsis describes "allegations from multiple women" and "allegations" of sexual assault — properly hedged.`)
  console.log(`  - Gonzales' affair characterized as "admitted" — factual, no allegation framing needed.`)
  console.log(`  - Staffer death described only as "by suicide" in the synopsis — no method detail in the user-facing synopsis.`)
  console.log(`  - Reviewer's note: "All allegations are accurately characterized as allegations and denials are noted."`)
  console.log(`\n  Verdict: hedging is proper. Named-individual risk is inherent to the story's subject matter (sexual misconduct allegations against named congressmen) and is not a hedging defect.`)
  console.log(`  Action: no text edits. Story stays published.`)
}

// ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n━━━ FOLLOW-UP EDITS — 2026-04-19 ━━━')

  const trumpFix = await fixTrumpMunir()
  const swalwellFix = await approveSwalwell()
  const hormuzReview = await fixHormuz()
  const hungaryReview = await fixHungary()

  console.log('\n\n━━━ DONE ━━━\n')

  // Final state check
  for (const [label, id] of [
    ['HORMUZ', HORMUZ_ID],
    ['HUNGARY', HUNGARY_ID],
    ['TRUMP', TRUMP_ID],
    ['SWALWELL', SWALWELL_ID],
  ] as const) {
    const s = await prisma.story.findUnique({
      where: { id },
      select: { status: true, qualityReviewCards: { orderBy: { createdAt: 'desc' }, take: 1, select: { overallRecommendation: true, createdAt: true } } },
    })
    const last = s?.qualityReviewCards[0]
    console.log(`  ${label.padEnd(10)} status=${s?.status} | latest card: ${last ? `${last.overallRecommendation} @ ${last.createdAt.toISOString()}` : '(none)'}`)
  }
  console.log()
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
