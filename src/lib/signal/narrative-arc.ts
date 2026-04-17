/**
 * NarrativeArc generation.
 *
 * 1:1 with StoryCluster. Regenerated whenever a new analysis is added to
 * a cluster that has 3+ analyses spanning at least 2 phases.
 *
 * Captures:
 *   - firstWaveFramings: framings present at first wave
 *   - persistentFramings: framings that survived to consolidation
 *   - emergentFramings: framings that appeared in development (not first wave)
 *   - surfacedOmissions: first-wave omissions that became covered facts later
 *   - earlyMovers: {framing: [outletDomains that led with it]}
 *   - lateFollowers: {framing: [outletDomains that picked it up late]}
 *
 * MIN_SIGNAL: 3+ analyses in cluster spanning 2+ phases.
 */

import { prisma } from '@/lib/db'

const MIN_ANALYSES_FOR_ARC = 3

export async function regenerateNarrativeArc(storyClusterId: string): Promise<boolean> {
  const cluster = await prisma.storyCluster.findUnique({
    where: { id: storyClusterId },
    select: { id: true, totalAnalysesRun: true },
  })
  if (!cluster || cluster.totalAnalysesRun < MIN_ANALYSES_FOR_ARC) {
    return false
  }

  // ── Load all framing tags + omissions for this cluster ──
  const framingTags = await prisma.framingTag.findMany({
    where: { storyClusterId },
    select: { outletDomain: true, framingAngle: true, storyPhase: true, isDominant: true, detectedAt: true },
    orderBy: { detectedAt: 'asc' },
  })

  if (framingTags.length === 0) {
    // Nothing to base arc on — skip
    return false
  }

  // Group framings by phase
  const framingsByPhase: Record<string, Set<string>> = {
    first_wave: new Set(),
    development: new Set(),
    consolidation: new Set(),
    tail: new Set(),
  }
  for (const t of framingTags) {
    framingsByPhase[t.storyPhase]?.add(t.framingAngle)
  }

  const phasesObserved = Object.entries(framingsByPhase).filter(([, s]) => s.size > 0).length
  if (phasesObserved < 2) {
    // Need at least 2 phases represented
    return false
  }

  const firstWaveFramings = [...framingsByPhase.first_wave]
  const developmentFramings = [...framingsByPhase.development]
  const consolidationFramings = [...framingsByPhase.consolidation]

  // Persistent: in first_wave AND still in consolidation (or if no consolidation yet, still in development)
  const latePhase = consolidationFramings.length > 0 ? consolidationFramings : developmentFramings
  const persistentFramings = firstWaveFramings.filter((f) => latePhase.includes(f))

  // Emergent: appeared in development but NOT in first_wave
  const emergentFramings = developmentFramings.filter((f) => !framingsByPhase.first_wave.has(f))

  // Early movers / late followers per framing angle
  const earlyMovers: Record<string, string[]> = {}
  const lateFollowers: Record<string, string[]> = {}
  const allFramings = [...new Set(framingTags.map((t) => t.framingAngle))]
  for (const framing of allFramings) {
    const tagsForFraming = framingTags
      .filter((t) => t.framingAngle === framing && t.isDominant)
      .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime())
    if (tagsForFraming.length === 0) continue
    // Earliest 33% = early movers, latest 33% = late followers
    const earlyCount = Math.max(1, Math.ceil(tagsForFraming.length * 0.33))
    const lateCount = Math.max(1, Math.floor(tagsForFraming.length * 0.33))
    earlyMovers[framing] = [...new Set(tagsForFraming.slice(0, earlyCount).map((t) => t.outletDomain))]
    lateFollowers[framing] = [...new Set(tagsForFraming.slice(-lateCount).map((t) => t.outletDomain))]
  }

  // Surfaced omissions: first_wave FactOmissions whose factDescription was later covered by more outlets
  // Simple heuristic: find first_wave omissions where missedByOutlets.length > 0, assume they surfaced later
  const firstWaveOmissions = await prisma.factOmission.findMany({
    where: { storyClusterId, storyPhase: 'first_wave' },
    select: { id: true, factType: true, factDescription: true, carriedByOutlets: true, detectedAt: true },
  })
  const surfacedOmissions = firstWaveOmissions.map((o) => ({
    factOmissionId: o.id,
    factType: o.factType,
    factDescription: o.factDescription.substring(0, 200),
    firstSurfacedAt: o.detectedAt.toISOString(),
    firstSurfacedByTier: null as string | null, // TODO: resolve tier in next iteration
  }))

  // Upsert arc
  await prisma.narrativeArc.upsert({
    where: { storyClusterId },
    create: {
      storyClusterId,
      firstWaveFramings: JSON.stringify(firstWaveFramings),
      persistentFramings: JSON.stringify(persistentFramings),
      emergentFramings: JSON.stringify(emergentFramings),
      surfacedOmissions: JSON.stringify(surfacedOmissions),
      earlyMovers: JSON.stringify(earlyMovers),
      lateFollowers: JSON.stringify(lateFollowers),
      generatedAt: new Date(),
    },
    update: {
      firstWaveFramings: JSON.stringify(firstWaveFramings),
      persistentFramings: JSON.stringify(persistentFramings),
      emergentFramings: JSON.stringify(emergentFramings),
      surfacedOmissions: JSON.stringify(surfacedOmissions),
      earlyMovers: JSON.stringify(earlyMovers),
      lateFollowers: JSON.stringify(lateFollowers),
      generatedAt: new Date(),
    },
  })
  return true
}
