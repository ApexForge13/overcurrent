import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

async function main() {
  for (const [label, id] of [
    ['TRUMP CEASEFIRE', 'cmo2cd81e003m12nmszpdacxn'],
    ['SWALWELL', 'cmo2pga5o003is0vruh98ui3e'],
  ] as const) {
    console.log(`\n━━━ ${label} (${id}) ━━━\n`)
    const story = await prisma.story.findUnique({
      where: { id },
      select: { id: true, status: true, headline: true, thePattern: true, synopsis: true },
    })
    if (!story) { console.log('  (not found)'); continue }
    console.log(`  status:   ${story.status}`)
    console.log(`\n  HEADLINE:\n    ${story.headline}\n`)
    console.log(`  PATTERN:\n    ${story.thePattern ?? '(no Pattern)'}\n`)
    console.log(`  SYNOPSIS:\n${story.synopsis.split('\n').map((l) => '    ' + l).join('\n')}`)
  }
  console.log()
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
