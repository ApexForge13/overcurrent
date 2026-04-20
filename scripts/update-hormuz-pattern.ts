/**
 * Direct DB update — set story cmo675t6k003m12ooj7zuoxwr.thePattern to the
 * admin-finalized text. No pipeline re-run, no quality re-review.
 *
 * Run once: npx tsx scripts/update-hormuz-pattern.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const STORY_ID = 'cmo675t6k003m12ooj7zuoxwr'

// Exact text per admin directive. \u2014 = em dash, \u2019 = right single quotation mark.
const NEW_PATTERN =
  "197 general-news sources covered who's shooting. The specialist insurance press \u2014 Lloyd\u2019s List, S&P Global, the Globe and Mail \u2014 covered the financial fallout. General readers never saw the connection."

async function main() {
  const before = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: { id: true, thePattern: true, status: true },
  })
  if (!before) throw new Error(`Story ${STORY_ID} not found`)

  console.log('BEFORE:')
  console.log(`  ${before.thePattern}`)
  console.log()

  const after = await prisma.story.update({
    where: { id: STORY_ID },
    data: { thePattern: NEW_PATTERN },
    select: { id: true, thePattern: true, status: true, updatedAt: true },
  })

  console.log('AFTER:')
  console.log(`  ${after.thePattern}`)
  console.log()
  console.log(`Story status: ${after.status}`)
  console.log(`updatedAt: ${after.updatedAt.toISOString()}`)
  console.log(`Pattern length: ${after.thePattern?.length ?? 0} chars`)

  // Byte-compare: confirm exactly the text we intended was stored
  if (after.thePattern === NEW_PATTERN) {
    console.log('\n✓ Pattern matches intended text exactly')
  } else {
    console.error('\n✗ Pattern mismatch — stored value differs from intended')
    console.error(`  intended length: ${NEW_PATTERN.length}`)
    console.error(`  stored length:   ${after.thePattern?.length ?? 0}`)
  }
}

main()
  .catch((err) => { console.error('FATAL:', err); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
