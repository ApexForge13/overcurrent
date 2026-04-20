/**
 * Continuation of apply-followup-edits.ts — Trump + Swalwell already applied.
 * This handles only Hormuz + Hungary (the remaining items).
 *
 * The first run failed on Hormuz because the database stores a curly
 * apostrophe (U+2019) in "Lloyd’s List", not a straight ASCII one. Fixed here.
 *
 * Run: npx tsx scripts/apply-followup-edits-2.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'
import { runQualityReview } from '../src/lib/quality-review'

dotenvConfig({ override: true })

const HORMUZ_ID = 'cmo675t6k003m12ooj7zuoxwr'
const HUNGARY_ID = 'cmo0z8d8n003koovr4jwbi9ca'

async function fixHormuz() {
  console.log('\n━━━ HORMUZ ━━━')
  const story = await prisma.story.findUnique({
    where: { id: HORMUZ_ID },
    select: { id: true, status: true, thePattern: true },
  })
  if (!story) throw new Error('Hormuz story not found')
  console.log(`  current status:  ${story.status}`)
  console.log(`  current Pattern: ${story.thePattern}`)

  // NOTE: curly apostrophe (U+2019) — actual char in the DB.
  const oldFragment = `Lloyd\u2019s List, S&P Global, the Globe and Mail`
  const newFragment = `Lloyd\u2019s List, S&P Global`
  if (!story.thePattern || !story.thePattern.includes(oldFragment)) {
    throw new Error(
      `Hormuz Pattern does not contain expected "${oldFragment}" — refusing to edit blindly`,
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
  if (!r) { console.log(`  ✗ runQualityReview returned null`); return null }
  console.log(`  → ${r.overallRecommendation.toUpperCase()} | patternVerified=${r.patternVerified} | $${r.reviewCost.toFixed(3)} | ${r.reviewDurationSeconds}s | ${r.webSearchesRun} searches${r.autoArchived ? ' | AUTO-ARCHIVED' : ''}`)
  if (r.killReason) console.log(`  killReason:    ${r.killReason}`)
  if (r.suggestedEdits) console.log(`  suggestedEdits:\n    ${r.suggestedEdits.replace(/\n/g, '\n    ')}`)
  console.log(`  scores:        ${JSON.stringify(r.editorialScores)}`)
  console.log(`  flags:         ${JSON.stringify(r.sensitivityFlags)}`)
  return r
}

async function fixHungary() {
  console.log('\n━━━ HUNGARY ━━━')
  const story = await prisma.story.findUnique({
    where: { id: HUNGARY_ID },
    select: {
      id: true, status: true, thePattern: true, confidenceNote: true,
      claims: { select: { id: true, sortOrder: true, claim: true, supportedBy: true }, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!story) throw new Error('Hungary story not found')
  console.log(`  current status:  ${story.status}`)
  console.log(`  current Pattern: ${story.thePattern?.substring(0, 100)}…`)

  const patternL = (story.thePattern ?? '').toLowerCase()
  if (!patternL.includes('miklóssy') && !patternL.includes('miklossy') && !patternL.includes('yle')) {
    throw new Error('Hungary Pattern does not contain expected Yle/Miklóssy reference — refusing to clear blindly')
  }

  const mullerClaim = story.claims.find(
    (c) => c.claim.includes('Müller') || c.claim.includes('Muller') || /la repubblica/i.test(c.supportedBy ?? ''),
  )
  if (!mullerClaim) throw new Error('Could not find Müller/La Repubblica claim in Hungary story')
  console.log(`  Müller claim to delete: [sortOrder=${mullerClaim.sortOrder}] ${mullerClaim.claim.substring(0, 100)}…`)
  console.log(`    supportedBy: ${mullerClaim.supportedBy}`)

  if (!story.confidenceNote) throw new Error('Hungary confidenceNote is empty')
  let confNote: { note?: string; buriedEvidence?: Array<Record<string, unknown>>; [k: string]: unknown }
  try { confNote = JSON.parse(story.confidenceNote) } catch (e) {
    throw new Error(`Could not parse Hungary confidenceNote as JSON: ${e instanceof Error ? e.message : e}`)
  }
  const evBefore = confNote.buriedEvidence ?? []
  console.log(`  buried evidence before: ${evBefore.length} items`)
  for (const e of evBefore) {
    console.log(`    sortOrder=${e.sortOrder} reportedBy=${e.reportedBy}`)
  }
  const evAfter = evBefore.filter((e) => {
    const reportedBy = String(e.reportedBy ?? '').toLowerCase()
    const fact = String(e.fact ?? '').toLowerCase()
    if (reportedBy.includes('yle') || fact.includes('miklóssy') || fact.includes('miklossy')) {
      console.log(`    REMOVING (Yle/Miklóssy): sortOrder=${e.sortOrder}`); return false
    }
    if (reportedBy.includes('la repubblica') || fact.includes('müller') || fact.includes('muller')) {
      console.log(`    REMOVING (La Repubblica/Müller): sortOrder=${e.sortOrder}`); return false
    }
    return true
  })
  console.log(`  buried evidence after:  ${evAfter.length} items`)
  confNote.buriedEvidence = evAfter
  const newConfNote = JSON.stringify(confNote)

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
  if (!r) { console.log(`  ✗ runQualityReview returned null`); return null }
  console.log(`  → ${r.overallRecommendation.toUpperCase()} | patternVerified=${r.patternVerified} | $${r.reviewCost.toFixed(3)} | ${r.reviewDurationSeconds}s | ${r.webSearchesRun} searches${r.autoArchived ? ' | AUTO-ARCHIVED' : ''}`)
  if (r.killReason) console.log(`  killReason:    ${r.killReason}`)
  if (r.suggestedEdits) console.log(`  suggestedEdits:\n    ${r.suggestedEdits.replace(/\n/g, '\n    ')}`)
  console.log(`  scores:        ${JSON.stringify(r.editorialScores)}`)
  console.log(`  flags:         ${JSON.stringify(r.sensitivityFlags)}`)
  return r
}

async function main() {
  await fixHormuz()
  await fixHungary()

  console.log('\n\n━━━ FINAL STATE ━━━\n')
  for (const [label, id] of [
    ['HORMUZ', HORMUZ_ID],
    ['HUNGARY', HUNGARY_ID],
    ['TRUMP', 'cmo2cd81e003m12nmszpdacxn'],
    ['SWALWELL', 'cmo2pga5o003is0vruh98ui3e'],
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
