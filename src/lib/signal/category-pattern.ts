/**
 * StoryCategoryPattern aggregation.
 *
 * The compounding evidence asset: "Across N diplomatic_negotiation analyses,
 * legal details are absent from First Wave wire coverage 73% of the time."
 *
 * Auto-populates from OutletAppearance + FactOmission + FramingTag event logs.
 * Recomputed after each analysis completes for the category it belongs to.
 *
 * MIN_SIGNAL: 10+ analyses in category for meaningful evidence claims.
 *             Below threshold → StoryCategoryPattern row still exists but
 *             admin UI labels it "Insufficient Data — X/10".
 */

import { prisma } from '@/lib/db'
import type { SignalCategory } from './signal-category'

export async function recomputeCategoryPattern(
  signalCategory: SignalCategory,
): Promise<void> {
  // ── 1. Get all analyses in this category via OutletAppearance distinct storyIds ──
  const appearances = await prisma.outletAppearance.findMany({
    where: { signalCategory },
    select: {
      storyId: true,
      storyClusterId: true,
      storyPhase: true,
      outletId: true,
      outletDomain: true,
    },
  })

  const storyIds = [...new Set(appearances.map((a) => a.storyId).filter((id): id is string => !!id))]
  const totalAnalyses = storyIds.length

  // Step 6: log contributing clusters' arc-quality breakdown as audit trail.
  // Category-pattern itself does not gate by arc quality — it is a descriptive
  // aggregate across all analyses in the category. Downstream consumers
  // (predictive-signal) apply the 60%+ arc-quality gate.
  const contributingClusterIds = [...new Set(appearances.map(a => a.storyClusterId).filter((x): x is string => !!x))]
  if (contributingClusterIds.length > 0) {
    const clusterQuality = await prisma.storyCluster.findMany({
      where: { id: { in: contributingClusterIds } },
      select: { id: true, arcCompleteness: true },
    })
    const qualityCounts = { complete: 0, partial: 0, first_wave_only: 0, incomplete: 0, unclassified: 0 }
    for (const c of clusterQuality) {
      const key = c.arcCompleteness ?? 'unclassified'
      qualityCounts[key as keyof typeof qualityCounts] = (qualityCounts[key as keyof typeof qualityCounts] ?? 0) + 1
    }
    console.log(`[categoryPattern] category=${signalCategory} contributing=${contributingClusterIds.length} arcs (complete=${qualityCounts.complete}, partial=${qualityCounts.partial}, first_wave_only=${qualityCounts.first_wave_only}, incomplete=${qualityCounts.incomplete}, unclassified=${qualityCounts.unclassified}) @ ${new Date().toISOString()}`)
  }

  // ── 2. avgAnalysesUntilStabilization — stub; needs arc data to compute properly ──
  // For now: 0 when <3 clusters, else average totalAnalysesRun of clusters in this category
  let avgAnalysesUntilStabilization = 0
  const clustersInCategory = await prisma.storyCluster.findMany({
    where: { signalCategory },
    select: { totalAnalysesRun: true },
  })
  if (clustersInCategory.length >= 3) {
    const sum = clustersInCategory.reduce((s, c) => s + c.totalAnalysesRun, 0)
    avgAnalysesUntilStabilization = sum / clustersInCategory.length
  }

  // ── 3. commonFirstWaveOmissions: {factType: count} ──
  // Count fact omissions from first_wave analyses in this category
  const firstWaveStoryIds = [...new Set(
    appearances.filter((a) => a.storyPhase === 'first_wave').map((a) => a.storyId).filter((id): id is string => !!id),
  )]
  let commonFirstWaveOmissions: Record<string, number> = {}
  if (firstWaveStoryIds.length > 0) {
    const omissions = await prisma.factOmission.findMany({
      where: { storyId: { in: firstWaveStoryIds } },
      select: { factType: true },
    })
    for (const o of omissions) {
      commonFirstWaveOmissions[o.factType] = (commonFirstWaveOmissions[o.factType] || 0) + 1
    }
  }

  // ── 4. leadingTiers / followingTiers ──
  // For each analysis, identify the outlet with earliest pickup (lowest hoursFromFirstDetection)
  // and the tier of that outlet. Aggregate to understand which tiers lead.
  const leadingTiers: Record<string, number> = {}
  const followingTiers: Record<string, number> = {}
  if (storyIds.length > 0) {
    // Get tier for each outletId
    const outletIds = [...new Set(appearances.map((a) => a.outletId).filter((id): id is string => !!id))]
    const outlets = await prisma.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, tier: true, domain: true },
    })
    const tierByOutletId = new Map(outlets.map((o) => [o.id, o.tier]))

    // Group appearances by storyId with hoursFromFirstDetection
    const appearancesWithTiming = await prisma.outletAppearance.findMany({
      where: { storyId: { in: storyIds }, hoursFromFirstDetection: { not: null } },
      select: { storyId: true, outletId: true, hoursFromFirstDetection: true },
    })

    const byStory = new Map<string, Array<{ outletId: string; hours: number }>>()
    for (const a of appearancesWithTiming) {
      if (!a.storyId || !a.outletId || a.hoursFromFirstDetection == null) continue
      const arr = byStory.get(a.storyId) ?? []
      arr.push({ outletId: a.outletId, hours: a.hoursFromFirstDetection })
      byStory.set(a.storyId, arr)
    }

    for (const [, arr] of byStory) {
      arr.sort((a, b) => a.hours - b.hours)
      // Leading: bottom 20% of pickup times (earliest arrivals)
      const leadCount = Math.max(1, Math.floor(arr.length * 0.2))
      const followCount = Math.max(1, Math.floor(arr.length * 0.2))
      for (let i = 0; i < leadCount; i++) {
        const t = tierByOutletId.get(arr[i].outletId)
        if (t) leadingTiers[t] = (leadingTiers[t] || 0) + 1
      }
      for (let i = arr.length - followCount; i < arr.length; i++) {
        const t = tierByOutletId.get(arr[i].outletId)
        if (t) followingTiers[t] = (followingTiers[t] || 0) + 1
      }
    }
  }

  // ── 5. originatingRegions / amplifyingRegions ──
  // Origin = region of cluster's first analysis; amplify = regions of later analyses
  // For now: just aggregate regions across all outlets in this category by appearance count
  const originatingRegions: Record<string, number> = {}
  const amplifyingRegions: Record<string, number> = {}
  if (appearances.length > 0) {
    const outletIds = [...new Set(appearances.map((a) => a.outletId).filter((id): id is string => !!id))]
    const outlets = await prisma.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, region: true },
    })
    const regionByOutletId = new Map(outlets.map((o) => [o.id, o.region]))
    for (const a of appearances) {
      if (!a.outletId) continue
      const region = regionByOutletId.get(a.outletId)
      if (!region) continue
      // Heuristic: first_wave appearances count as originating, later phases as amplifying
      if (a.storyPhase === 'first_wave') {
        originatingRegions[region] = (originatingRegions[region] || 0) + 1
      } else {
        amplifyingRegions[region] = (amplifyingRegions[region] || 0) + 1
      }
    }
  }

  // ── Upsert ──
  await prisma.storyCategoryPattern.upsert({
    where: { signalCategory },
    create: {
      signalCategory,
      avgAnalysesUntilStabilization,
      commonFirstWaveOmissions: JSON.stringify(commonFirstWaveOmissions),
      leadingTiers: JSON.stringify(leadingTiers),
      followingTiers: JSON.stringify(followingTiers),
      originatingRegions: JSON.stringify(originatingRegions),
      amplifyingRegions: JSON.stringify(amplifyingRegions),
      totalAnalyses,
      lastComputedAt: new Date(),
    },
    update: {
      avgAnalysesUntilStabilization,
      commonFirstWaveOmissions: JSON.stringify(commonFirstWaveOmissions),
      leadingTiers: JSON.stringify(leadingTiers),
      followingTiers: JSON.stringify(followingTiers),
      originatingRegions: JSON.stringify(originatingRegions),
      amplifyingRegions: JSON.stringify(amplifyingRegions),
      totalAnalyses,
      lastComputedAt: new Date(),
    },
  })
}
