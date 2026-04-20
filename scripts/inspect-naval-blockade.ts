import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const ID = 'cmnyb2e3z0026movrqvv557s9'

async function main() {
  const story = await prisma.story.findUnique({
    where: { id: ID },
    select: {
      id: true, status: true, headline: true, thePattern: true, synopsis: true,
      confidenceLevel: true, confidenceNote: true, sourceCount: true, publishedAt: true,
      claims: { select: { sortOrder: true, claim: true, confidence: true, supportedBy: true }, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!story) { console.log('not found'); return }
  console.log(`status:      ${story.status}`)
  console.log(`publishedAt: ${story.publishedAt?.toISOString()}`)
  console.log(`sourceCount: ${story.sourceCount}`)
  console.log(`confidence:  ${story.confidenceLevel}`)
  console.log(`\nHEADLINE:\n  ${story.headline}`)
  console.log(`\nPATTERN:\n  ${story.thePattern ?? '(none — this is what we need to write)'}`)
  console.log(`\nSYNOPSIS:\n${story.synopsis.split('\n').map((l) => '  ' + l).join('\n')}`)
  console.log(`\nCONFIDENCE NOTE (raw):\n  ${story.confidenceNote}`)
  console.log(`\nCLAIMS (${story.claims.length}):`)
  for (const c of story.claims) {
    console.log(`  [${c.sortOrder}] (${c.confidence}) ${c.claim}`)
    if (c.supportedBy) console.log(`      supported by: ${c.supportedBy}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
