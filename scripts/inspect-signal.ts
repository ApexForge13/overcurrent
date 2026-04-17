/**
 * Signal layer inspection — shows what got written by the signal tracking
 * layer for the most recent analysis (or a specific slug).
 *
 * Run: npx tsx scripts/inspect-signal.ts [slug]
 */

import 'dotenv/config'
import { prisma } from '../src/lib/db'

async function main() {
  const arg = process.argv[2]

  const story = arg
    ? await prisma.story.findUnique({ where: { slug: arg } })
    : await prisma.story.findFirst({ orderBy: { createdAt: 'desc' } })

  if (!story) {
    console.error('No story found.')
    process.exit(1)
  }

  console.log(`\n━━━ Signal Layer Inspection ━━━`)
  console.log(`Story: ${story.headline}`)
  console.log(`Slug: ${story.slug}`)
  console.log(`Created: ${story.createdAt.toISOString()}`)
  console.log(``)
  console.log(`━━━ Story fields (new Session 1) ━━━`)
  console.log(`  signalCategory:              ${story.signalCategory ?? '(null)'}`)
  console.log(`  storyPhase:                  ${story.storyPhase ?? '(null)'}`)
  console.log(`  storyClusterId:              ${story.storyClusterId ?? '(null)'}`)
  console.log(`  clusterOverride:             ${story.clusterOverride ?? '(null)'}`)
  console.log(`  signalCategoryOverriddenBy:  ${story.signalCategoryOverriddenBy ?? '(null)'}`)

  if (story.storyClusterId) {
    const cluster = await prisma.storyCluster.findUnique({
      where: { id: story.storyClusterId },
    })
    if (cluster) {
      console.log(``)
      console.log(`━━━ StoryCluster ━━━`)
      console.log(`  id:               ${cluster.id}`)
      console.log(`  clusterHeadline:  ${cluster.clusterHeadline}`)
      console.log(`  signalCategory:   ${cluster.signalCategory ?? '(null)'}`)
      console.log(`  firstDetectedAt:  ${cluster.firstDetectedAt.toISOString()}`)
      console.log(`  currentPhase:     ${cluster.currentPhase}`)
      console.log(`  totalAnalysesRun: ${cluster.totalAnalysesRun}`)
      let keywords: string[] = []
      try { keywords = JSON.parse(cluster.clusterKeywords) } catch {}
      console.log(`  entities (${keywords.length}): ${keywords.join(', ')}`)
    }
  }

  // OutletAppearance
  const appearances = await prisma.outletAppearance.count({ where: { storyId: story.id } })
  const appearancesByPhase = await prisma.outletAppearance.groupBy({
    by: ['storyPhase'],
    where: { storyId: story.id },
    _count: true,
  })
  console.log(``)
  console.log(`━━━ OutletAppearance rows ━━━`)
  console.log(`  total: ${appearances}`)
  for (const row of appearancesByPhase) {
    console.log(`  ${row.storyPhase}: ${row._count}`)
  }

  // FactOmission
  const factOmissions = await prisma.factOmission.findMany({
    where: { storyId: story.id },
    select: { factType: true, factDescription: true, presentInPct: true, carriedByOutlets: true, missedByOutlets: true },
  })
  console.log(``)
  console.log(`━━━ FactOmission rows (${factOmissions.length}) ━━━`)
  for (const fo of factOmissions) {
    let carried: string[] = []
    let missed: string[] = []
    try { carried = JSON.parse(fo.carriedByOutlets) } catch {}
    try { missed = JSON.parse(fo.missedByOutlets) } catch {}
    console.log(`  [${fo.factType}] ${fo.factDescription.substring(0, 100)}`)
    console.log(`    in ${fo.presentInPct}% of sources | carried=${carried.length} missed=${missed.length}`)
  }

  // FramingTag
  const framingTags = await prisma.framingTag.count({ where: { storyId: story.id } })
  console.log(``)
  console.log(`━━━ FramingTag rows: ${framingTags} ━━━`)

  // PredictiveSignal
  const predictive = await prisma.predictiveSignal.findMany({
    where: { storyId: story.id },
    orderBy: { generatedAt: 'desc' },
    take: 1,
  })
  if (predictive.length > 0) {
    const p = predictive[0]
    console.log(``)
    console.log(`━━━ PredictiveSignal ━━━`)
    console.log(`  predictedDominantFraming:   ${p.predictedDominantFraming}`)
    console.log(`  framingConfidencePct:       ${p.framingConfidencePct}%`)
    console.log(`  momentumFlag:               ${p.momentumFlag}`)
    console.log(`  momentumReason:             ${p.momentumReason}`)
    console.log(`  computedFromAnalysesCount:  ${p.computedFromAnalysesCount}`)
    let risks: Array<{ factType: string; likelyMissedBy: string[]; likelyCarriedBy: string[] }> = []
    try { risks = JSON.parse(p.topOmissionRisks) } catch {}
    console.log(`  topOmissionRisks (${risks.length}):`)
    for (const r of risks) {
      console.log(`    [${r.factType}] missed by: ${r.likelyMissedBy.join(', ') || '—'}`)
      console.log(`                 carried by: ${r.likelyCarriedBy.join(', ') || '—'}`)
    }
  }

  // NarrativeArc
  if (story.storyClusterId) {
    const arc = await prisma.narrativeArc.findUnique({ where: { storyClusterId: story.storyClusterId } })
    if (arc) {
      console.log(``)
      console.log(`━━━ NarrativeArc ━━━`)
      console.log(`  generatedAt: ${arc.generatedAt.toISOString()}`)
      let firstWave: string[] = []
      let persistent: string[] = []
      let emergent: string[] = []
      try { firstWave = JSON.parse(arc.firstWaveFramings) } catch {}
      try { persistent = JSON.parse(arc.persistentFramings) } catch {}
      try { emergent = JSON.parse(arc.emergentFramings) } catch {}
      console.log(`  firstWaveFramings:   ${firstWave.join(', ') || '—'}`)
      console.log(`  persistentFramings:  ${persistent.join(', ') || '—'}`)
      console.log(`  emergentFramings:    ${emergent.join(', ') || '—'}`)
    } else {
      console.log(``)
      console.log(`━━━ NarrativeArc: not generated yet (needs 3+ analyses across 2+ phases) ━━━`)
    }
  }

  // Category pattern (cluster-level)
  if (story.signalCategory) {
    const pattern = await prisma.storyCategoryPattern.findUnique({
      where: { signalCategory: story.signalCategory },
    })
    if (pattern) {
      console.log(``)
      console.log(`━━━ StoryCategoryPattern (${story.signalCategory}) ━━━`)
      console.log(`  totalAnalyses:                   ${pattern.totalAnalyses}`)
      console.log(`  avgAnalysesUntilStabilization:   ${pattern.avgAnalysesUntilStabilization.toFixed(1)}`)
      console.log(`  leadingTiers:                    ${pattern.leadingTiers}`)
      console.log(`  followingTiers:                  ${pattern.followingTiers}`)
      console.log(`  originatingRegions:              ${pattern.originatingRegions}`)
      console.log(`  lastComputedAt:                  ${pattern.lastComputedAt.toISOString()}`)
    }
  }

  // Global: how many fingerprints do we have with >= 20 appearances?
  const allFingerprints = await prisma.outletFingerprint.findMany({
    select: { totalAppearances: true },
  })
  const reliable = allFingerprints.filter(f => f.totalAppearances >= 20).length
  const partial = allFingerprints.filter(f => f.totalAppearances >= 5 && f.totalAppearances < 20).length
  const early = allFingerprints.filter(f => f.totalAppearances < 5).length
  console.log(``)
  console.log(`━━━ Global outlet fingerprint reliability ━━━`)
  console.log(`  Reliable (≥20 appearances):   ${reliable}`)
  console.log(`  Partial (5-19 appearances):   ${partial}`)
  console.log(`  Early data (<5 appearances):  ${early}`)
  console.log(`  Total outlets fingerprinted:  ${allFingerprints.length}`)

  console.log(``)
}

main()
  .catch(console.error)
  .finally(async () => { await prisma.$disconnect() })
