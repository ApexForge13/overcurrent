import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

async function main() {
  const total = await prisma.caseStudyEntry.count()
  console.log(`\nCaseStudyEntry rows in prod DB: ${total}\n`)
  if (total === 0) return

  const entries = await prisma.caseStudyEntry.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      headline: true,
      signalType: true,
      divergenceType: true,
      storyPhaseAtDetection: true,
      isPublishable: true,
      storyClusterId: true,
      umbrellaArcId: true,
      rawSignalLayerId: true,
    },
  })

  for (const e of entries) {
    console.log(`  ${e.id}`)
    console.log(`    createdAt:           ${e.createdAt.toISOString()}`)
    console.log(`    headline:            ${e.headline.substring(0, 110)}${e.headline.length > 110 ? '…' : ''}`)
    console.log(`    signalType:          ${e.signalType}`)
    console.log(`    divergenceType:      ${e.divergenceType}`)
    console.log(`    storyPhase:          ${e.storyPhaseAtDetection}`)
    console.log(`    isPublishable:       ${e.isPublishable}`)
    console.log(`    storyClusterId:      ${e.storyClusterId}`)
    console.log(`    umbrellaArcId:       ${e.umbrellaArcId ?? '(none)'}`)
    console.log(`    rawSignalLayerId:    ${e.rawSignalLayerId ?? '(none)'}`)
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
