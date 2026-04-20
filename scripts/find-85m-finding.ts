/**
 * Broader search for the "8.5M investment" finding. Two-pass:
 *   PASS 1: show every "8.5" hit with surrounding context (no pattern filter)
 *   PASS 2: search for "investment" + Hormuz cluster context to find the
 *           finding even if the number is mis-remembered.
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const HORMUZ_CLUSTER_ID = 'cmo5efugm00c312pikkw7jsl4'

function snippetAt(text: string, needle: string, pad = 150): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return text.slice(0, 200)
  const start = Math.max(0, idx - pad)
  const end = Math.min(text.length, idx + needle.length + pad)
  return (start > 0 ? '\u2026' : '') + text.substring(start, end) + (end < text.length ? '\u2026' : '')
}

async function main() {
  console.log('\n━━━ PASS 1: every "8.5" hit across debate rounds (Hormuz cluster only) ━━━\n')

  // Get all stories in the Hormuz cluster first
  const hormuzStories = await prisma.story.findMany({
    where: { storyClusterId: HORMUZ_CLUSTER_ID },
    select: { id: true, headline: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Hormuz cluster has ${hormuzStories.length} stor${hormuzStories.length === 1 ? 'y' : 'ies'}:`)
  for (const s of hormuzStories) {
    console.log(`  ${s.id} | ${s.status.padEnd(10)} | ${s.headline.substring(0, 90)}`)
  }
  console.log()

  const storyIds = hormuzStories.map((s) => s.id)

  // Show every "8.5" hit in debate rounds for these stories with full context
  const debateRows = await prisma.$queryRawUnsafe<Array<{
    id: string
    storyId: string
    region: string
    round: number
    modelName: string
    content: string
  }>>(
    `SELECT id::text AS id, "storyId"::text AS "storyId", region::text AS region, round, "modelName"::text AS "modelName", content::text AS content
     FROM "DebateRound"
     WHERE content::text ILIKE '%8.5%'
       AND "storyId" = ANY($1::text[])
     LIMIT 30`,
    storyIds,
  )
  console.log(`\nDEBATE ROUNDS with "8.5" in Hormuz cluster: ${debateRows.length}`)
  for (const d of debateRows) {
    // Find ALL occurrences of "8.5" in content
    const text = d.content
    let pos = 0
    let nth = 0
    while (true) {
      const idx = text.indexOf('8.5', pos)
      if (idx < 0) break
      nth += 1
      const start = Math.max(0, idx - 80)
      const end = Math.min(text.length, idx + 100)
      console.log(`\n  story=${d.storyId.substring(0, 12)} region=${d.region} round=${d.round} model=${d.modelName} (occurrence ${nth})`)
      console.log(`    "...${text.substring(start, end).replace(/\s+/g, ' ').trim()}..."`)
      pos = idx + 1
      if (nth >= 5) break // cap per row
    }
  }

  // ── PASS 2: investment-focused hunt
  console.log('\n\n━━━ PASS 2: "investment" hits in Hormuz cluster (any debate round) ━━━\n')
  const investRows = await prisma.$queryRawUnsafe<Array<{
    id: string
    storyId: string
    region: string
    round: number
    modelName: string
    content: string
  }>>(
    `SELECT id::text AS id, "storyId"::text AS "storyId", region::text AS region, round, "modelName"::text AS "modelName", content::text AS content
     FROM "DebateRound"
     WHERE content::text ILIKE '%investment%'
       AND "storyId" = ANY($1::text[])
     LIMIT 30`,
    storyIds,
  )
  console.log(`DEBATE ROUNDS with "investment" in Hormuz cluster: ${investRows.length}`)
  for (const d of investRows) {
    const text = d.content
    const lower = text.toLowerCase()
    let pos = 0
    let nth = 0
    while (true) {
      const idx = lower.indexOf('investment', pos)
      if (idx < 0) break
      nth += 1
      const start = Math.max(0, idx - 120)
      const end = Math.min(text.length, idx + 200)
      console.log(`\n  story=${d.storyId.substring(0, 12)} region=${d.region} round=${d.round} model=${d.modelName} (occurrence ${nth})`)
      console.log(`    "...${text.substring(start, end).replace(/\s+/g, ' ').trim()}..."`)
      pos = idx + 1
      if (nth >= 3) break
    }
  }

  // ── PASS 3: any dollar figure in Hormuz buried evidence
  console.log('\n\n━━━ PASS 3: any "$" in Hormuz stories\' confidenceNote (buried evidence lives here) ━━━\n')
  for (const s of hormuzStories) {
    const story = await prisma.story.findUnique({
      where: { id: s.id },
      select: { confidenceNote: true },
    })
    if (!story?.confidenceNote) continue
    // Find dollar figures
    const matches = [...story.confidenceNote.matchAll(/\$[\d,.]+\s*(?:million|billion|M|B|trillion)?/gi)]
    if (matches.length === 0) continue
    console.log(`Story ${s.id} (${s.status}) — ${matches.length} dollar figure(s) in confidenceNote:`)
    for (const m of matches.slice(0, 12)) {
      console.log(`    ${m[0]}    \u2014 context: ${snippetAt(story.confidenceNote!, m[0], 80)}`)
    }
    console.log()
  }

  // ── PASS 4: any dollar figure in claims for Hormuz stories
  console.log('\n━━━ PASS 4: dollar figures in Claim text for Hormuz stories ━━━\n')
  const dollarClaims = await prisma.claim.findMany({
    where: {
      storyId: { in: storyIds },
      OR: [
        { claim: { contains: '$', mode: 'insensitive' } },
        { claim: { contains: 'million', mode: 'insensitive' } },
        { claim: { contains: 'billion', mode: 'insensitive' } },
      ],
    },
    select: { storyId: true, sortOrder: true, claim: true, supportedBy: true },
  })
  console.log(`${dollarClaims.length} candidate claims:`)
  for (const c of dollarClaims) {
    console.log(`  story=${c.storyId.substring(0, 12)} sortOrder=${c.sortOrder}`)
    console.log(`    ${c.claim.substring(0, 250)}`)
    console.log(`    supportedBy: ${(c.supportedBy ?? '').substring(0, 200)}`)
    console.log()
  }

  console.log('━━━ DONE ━━━\n')
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
