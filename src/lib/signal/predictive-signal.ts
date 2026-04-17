/**
 * Predictive signal compute.
 *
 * Runs on first-wave analyses only. For each new analysis:
 *   1. Look up outlet fingerprints for every outlet present
 *   2. Aggregate their historical framing distribution for this signalCategory
 *   3. Predict dominant framing at consolidation with a confidence %
 *   4. Flag top omission risks from outlet omissionRate fingerprints
 *   5. Compute momentum: stable | shifting | contested
 *
 * Only surfaced in admin UI if CategoryEnablement.enabled is true for the category.
 *
 * MIN_SIGNAL: 5+ prior analyses in the same signalCategory for confidence ≥40%.
 *             Below 5 → admin UI labels this "Insufficient Data — N/5".
 */

import { prisma } from '@/lib/db'
import type { SignalCategory } from './signal-category'
import type { FactType } from './fact-omission'

export interface PredictiveSignalOutput {
  id: string
  predictedDominantFraming: string
  framingConfidencePct: number
  topOmissionRisks: Array<{
    factType: FactType
    likelyMissedBy: string[]
    likelyCarriedBy: string[]
  }>
  momentumFlag: 'stable' | 'shifting' | 'contested'
  momentumReason: string
  computedFromAnalysesCount: number
}

const MIN_CATEGORY_ANALYSES_FOR_HIGH_CONFIDENCE = 5

/**
 * Compute predictive signal for a first_wave analysis.
 * Returns the saved PredictiveSignal row or null if insufficient data.
 */
export async function computePredictiveSignal(
  storyId: string,
  storyClusterId: string,
  signalCategory: SignalCategory,
): Promise<PredictiveSignalOutput | null> {
  // ── 1. Gather outlets that appeared in this analysis ──
  const appearances = await prisma.outletAppearance.findMany({
    where: { storyId },
    select: { outletId: true, outletDomain: true },
  })
  const outletIds = [...new Set(appearances.map((a) => a.outletId).filter((id): id is string => !!id))]
  if (outletIds.length === 0) return null

  // ── 2. Load their fingerprints + tiers ──
  const outlets = await prisma.outlet.findMany({
    where: { id: { in: outletIds } },
    include: { fingerprint: true },
  })

  // ── 3. How many prior analyses support the pattern? ──
  const priorAnalyses = await prisma.outletAppearance.findMany({
    where: { signalCategory, storyId: { not: storyId } },
    select: { storyId: true },
    distinct: ['storyId'],
  })
  const computedFromAnalysesCount = priorAnalyses.length

  // ── 4. Aggregate framing predictions from outlet fingerprints ──
  // For each outlet, what's their typical framing in this category?
  // Weighted by totalAppearances (more appearances = more reliable).
  const framingVotes: Record<string, number> = {}
  let totalFingerprintWeight = 0
  for (const o of outlets) {
    if (!o.fingerprint) continue
    if (o.fingerprint.totalAppearances < 5) continue // Too few appearances to trust this outlet's pattern
    try {
      const dist = JSON.parse(o.fingerprint.primaryFramingDistribution || '{}') as Record<string, Record<string, number>>
      const catDist = dist[signalCategory]
      if (!catDist) continue
      for (const [framing, pct] of Object.entries(catDist)) {
        const weight = pct * Math.log(1 + o.fingerprint.totalAppearances)
        framingVotes[framing] = (framingVotes[framing] || 0) + weight
        totalFingerprintWeight += weight
      }
    } catch { /* ignore */ }
  }

  let predictedDominantFraming = 'unknown'
  let framingConfidencePct = 0
  if (totalFingerprintWeight > 0) {
    const sorted = Object.entries(framingVotes).sort((a, b) => b[1] - a[1])
    predictedDominantFraming = sorted[0]?.[0] ?? 'unknown'
    const topWeight = sorted[0]?.[1] ?? 0
    const rawConfidence = totalFingerprintWeight > 0 ? (topWeight / totalFingerprintWeight) * 100 : 0
    // Cap confidence by category-level data availability
    const categoryDataFactor = Math.min(1, computedFromAnalysesCount / MIN_CATEGORY_ANALYSES_FOR_HIGH_CONFIDENCE)
    framingConfidencePct = Math.round(rawConfidence * categoryDataFactor)
  }

  // ── 5. Top omission risks ──
  // Find fact types this outlet mix historically misses in this category.
  // Aggregate by factType: sum of omissionRates weighted by outlet presence.
  const omissionRiskByType: Record<string, { likelyMissedBy: string[]; likelyCarriedBy: string[] }> = {}

  // Look at historical FactOmissions in this category
  const priorStoryIds = priorAnalyses.map((a) => a.storyId).filter((id): id is string => !!id)
  if (priorStoryIds.length > 0) {
    const historicalOmissions = await prisma.factOmission.findMany({
      where: { storyId: { in: priorStoryIds } },
      select: { factType: true, carriedByOutlets: true, missedByOutlets: true },
    })

    const typeStats: Record<string, { missed: Map<string, number>; carried: Map<string, number> }> = {}
    for (const fo of historicalOmissions) {
      typeStats[fo.factType] ??= { missed: new Map(), carried: new Map() }
      let missed: string[] = []
      let carried: string[] = []
      try { missed = JSON.parse(fo.missedByOutlets) } catch {}
      try { carried = JSON.parse(fo.carriedByOutlets) } catch {}
      for (const d of missed) typeStats[fo.factType].missed.set(d, (typeStats[fo.factType].missed.get(d) || 0) + 1)
      for (const d of carried) typeStats[fo.factType].carried.set(d, (typeStats[fo.factType].carried.get(d) || 0) + 1)
    }

    // For each factType, identify which of THIS analysis's outlets are likely to miss vs carry
    const currentDomains = new Set(appearances.map((a) => a.outletDomain))
    for (const [factType, { missed, carried }] of Object.entries(typeStats)) {
      const likelyMissedBy = [...missed.entries()]
        .filter(([d]) => currentDomains.has(d))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([d]) => d)
      const likelyCarriedBy = [...carried.entries()]
        .filter(([d]) => currentDomains.has(d))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([d]) => d)
      if (likelyMissedBy.length > 0 || likelyCarriedBy.length > 0) {
        omissionRiskByType[factType] = { likelyMissedBy, likelyCarriedBy }
      }
    }
  }
  // Keep top 2 risks (by missedBy count)
  const topOmissionRisks = Object.entries(omissionRiskByType)
    .sort((a, b) => b[1].likelyMissedBy.length - a[1].likelyMissedBy.length)
    .slice(0, 2)
    .map(([factType, risk]) => ({
      factType: factType as FactType,
      likelyMissedBy: risk.likelyMissedBy,
      likelyCarriedBy: risk.likelyCarriedBy,
    }))

  // ── 6. Momentum flag ──
  // stable: current outlet mix has historically produced consistent framing for this category
  // shifting: some tiers (e.g. regional, specialty) haven't weighed in yet — framing likely to evolve
  // contested: current outlet mix has historically produced divergent framing (high entropy)
  let momentumFlag: 'stable' | 'shifting' | 'contested' = 'stable'
  let momentumReason = 'Default — insufficient data to determine momentum'

  if (totalFingerprintWeight > 0) {
    const sortedVotes = Object.entries(framingVotes).sort((a, b) => b[1] - a[1])
    const topShare = (sortedVotes[0]?.[1] ?? 0) / totalFingerprintWeight
    const secondShare = (sortedVotes[1]?.[1] ?? 0) / totalFingerprintWeight
    const present = new Set(outlets.map((o) => o.tier))
    const missingTiers = ['wire_service', 'national', 'regional', 'specialty', 'emerging'].filter((t) => !present.has(t))

    if (topShare >= 0.6 && missingTiers.length <= 1) {
      momentumFlag = 'stable'
      momentumReason = `Top framing "${predictedDominantFraming}" dominates (${Math.round(topShare * 100)}%) and most tiers represented.`
    } else if (topShare < 0.4 || (topShare - secondShare) < 0.1) {
      momentumFlag = 'contested'
      momentumReason = `Framing split: top two angles within 10% (${Math.round(topShare * 100)}% vs ${Math.round(secondShare * 100)}%). Current outlet mix historically produces divergent framing.`
    } else if (missingTiers.length >= 2) {
      momentumFlag = 'shifting'
      momentumReason = `Absent tiers: ${missingTiers.join(', ')}. Framing likely to evolve as these outlets weigh in.`
    }
  }

  // ── 7. Persist ──
  const saved = await prisma.predictiveSignal.create({
    data: {
      storyId,
      storyClusterId,
      predictedDominantFraming,
      framingConfidencePct,
      topOmissionRisks: JSON.stringify(topOmissionRisks),
      momentumFlag,
      momentumReason,
      computedFromAnalysesCount,
    },
  })

  return {
    id: saved.id,
    predictedDominantFraming,
    framingConfidencePct,
    topOmissionRisks,
    momentumFlag,
    momentumReason,
    computedFromAnalysesCount,
  }
}
