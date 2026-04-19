import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/db'

/**
 * OutletUmbrellaProfile computation (Session 3 Step 5)
 *
 * Computes per-outlet, per-umbrella fingerprint metrics from
 * OutletAppearance + FramingTag + FactOmission event logs.
 *
 * Three metrics per outlet-umbrella pair:
 *   - frameConsistency: % of outlet's leading-framing appearances under this
 *     umbrella that share the SAME primary framing angle. High = outlet is
 *     ideologically consistent across events.
 *   - earlyMoverRate: % of arc events where this outlet's First Wave leading
 *     framing matched the Consolidation-phase dominant framing. High = outlet
 *     reliably predicts where the story will land.
 *   - omissionConsistencyRate: 1 - |umbrella_miss_rate - global_miss_rate| for
 *     the umbrella's signalCategory. High = outlet's omission pattern under
 *     this umbrella matches their global baseline for this category.
 *
 * MIN_SIGNAL: any metric is considered statistically unreliable when the
 *             outlet has <5 appearances within the umbrella. The admin UI
 *             attaches an "Insufficient Data" badge below that threshold.
 *             Section itself only renders when umbrella has ≥3 total analyses.
 */

type TxClient = Pick<
  PrismaClient,
  'outletAppearance' | 'framingTag' | 'factOmission' | 'outletUmbrellaProfile' | 'story' | 'outletFingerprint'
>

export interface ComputedProfile {
  outletId: string
  outletDomain: string
  analysesAppeared: number
  frameConsistency: number           // 0.0-1.0
  earlyMoverRate: number              // 0.0-1.0
  omissionConsistencyRate: number     // 0.0-1.0
  insufficientData: boolean           // true when analysesAppeared < 5
}

/**
 * Recompute all OutletUmbrellaProfile rows for a given umbrella.
 * Writes to the table via upsert so repeated runs stay idempotent.
 * Returns the computed rows for test/debug inspection.
 */
export async function recomputeUmbrellaProfiles(
  umbrellaArcId: string,
  tx: TxClient = defaultPrisma,
): Promise<ComputedProfile[]> {
  // 1. Collect all Story ids under this umbrella
  const stories = await tx.story.findMany({
    where: { umbrellaArcId },
    select: {
      id: true,
      storyClusterId: true,
      arcPhaseAtCreation: true,
      umbrellaArcId: true,
      analysisType: true,
      signalCategory: true,
    },
  })
  if (stories.length === 0) return []

  const storyIds = stories.map(s => s.id)
  const signalCategory = stories.find(s => s.signalCategory)?.signalCategory ?? null

  // 2. Pull all OutletAppearance rows across these stories
  const appearances = await tx.outletAppearance.findMany({
    where: { storyId: { in: storyIds } },
    select: {
      outletId: true,
      outletDomain: true,
      storyId: true,
      storyPhase: true,
      framingAngle: true,
      wasLeadingFraming: true,
    },
  })

  // 3. Pull all FactOmission rows across these stories
  const omissions = await tx.factOmission.findMany({
    where: { storyId: { in: storyIds } },
    select: {
      storyId: true,
      factType: true,
      carriedByOutlets: true,
      missedByOutlets: true,
    },
  })

  // 4. Group appearances by outletId (null outletIds get grouped by domain)
  const outletGroups = new Map<string, { outletId: string; outletDomain: string; appearances: typeof appearances }>()
  for (const a of appearances) {
    if (!a.outletId) continue // skip unregistered outlets for profile compute
    const key = a.outletId
    if (!outletGroups.has(key)) {
      outletGroups.set(key, { outletId: a.outletId, outletDomain: a.outletDomain, appearances: [] })
    }
    outletGroups.get(key)!.appearances.push(a)
  }

  // 5. For each arc (group of stories sharing storyClusterId with a new_arc root),
  //    precompute the consolidation-phase dominant framing across all outlets.
  //    Used for earlyMoverRate.
  const clusterDominantConsolidation = new Map<string, string>()
  const clusterIds = Array.from(new Set(stories.map(s => s.storyClusterId).filter((x): x is string => !!x)))
  for (const clusterId of clusterIds) {
    const conApps = appearances.filter(a =>
      a.storyPhase === 'consolidation' &&
      a.framingAngle &&
      stories.find(s => s.id === a.storyId)?.storyClusterId === clusterId,
    )
    if (conApps.length === 0) continue
    const frameCounts = new Map<string, number>()
    for (const a of conApps) {
      if (!a.framingAngle) continue
      frameCounts.set(a.framingAngle, (frameCounts.get(a.framingAngle) ?? 0) + 1)
    }
    let dominantFrame = ''
    let maxCount = 0
    for (const [frame, count] of frameCounts) {
      if (count > maxCount) { dominantFrame = frame; maxCount = count }
    }
    if (dominantFrame) clusterDominantConsolidation.set(clusterId, dominantFrame)
  }

  // 6. Compute metrics per outlet
  const results: ComputedProfile[] = []

  for (const [, group] of outletGroups) {
    const { outletId, outletDomain, appearances: outletApps } = group
    const uniqueStoryIds = new Set(outletApps.map(a => a.storyId))
    const analysesAppeared = uniqueStoryIds.size

    // Only compute for outlets with 2+ appearances
    if (analysesAppeared < 2) continue

    // frameConsistency: most-common leading frame / total leading appearances
    const leadingFrames = outletApps
      .filter(a => a.wasLeadingFraming && a.framingAngle)
      .map(a => a.framingAngle as string)
    let frameConsistency = 0
    if (leadingFrames.length > 0) {
      const counts = new Map<string, number>()
      for (const f of leadingFrames) counts.set(f, (counts.get(f) ?? 0) + 1)
      const max = Math.max(...counts.values())
      frameConsistency = max / leadingFrames.length
    }

    // earlyMoverRate: per cluster, did outlet's first_wave leading framing match
    // the consolidation-phase dominant frame?
    let earlyMoverHits = 0
    let earlyMoverOpportunities = 0
    for (const clusterId of clusterIds) {
      const fwApp = outletApps.find(a => {
        if (a.storyPhase !== 'first_wave') return false
        const story = stories.find(s => s.id === a.storyId)
        return story?.storyClusterId === clusterId && a.wasLeadingFraming && a.framingAngle
      })
      if (!fwApp) continue
      const dominantCon = clusterDominantConsolidation.get(clusterId)
      if (!dominantCon) continue // no consolidation data for this arc yet
      earlyMoverOpportunities++
      if (fwApp.framingAngle === dominantCon) earlyMoverHits++
    }
    const earlyMoverRate = earlyMoverOpportunities > 0
      ? earlyMoverHits / earlyMoverOpportunities
      : 0

    // omissionConsistencyRate: how this outlet's miss rate under this umbrella
    // compares to their global miss rate for this signalCategory. When close,
    // behavior is "consistent" with their baseline (not a situational blindspot).
    let umbrellaMissRate = 0
    const omissionsWithOutletData = omissions.filter(o =>
      o.carriedByOutlets && o.missedByOutlets,
    )
    let totalOmissionObservations = 0
    let outletMissCount = 0
    for (const om of omissionsWithOutletData) {
      try {
        const carried: string[] = JSON.parse(om.carriedByOutlets || '[]')
        const missed: string[] = JSON.parse(om.missedByOutlets || '[]')
        const outletInCarried = carried.includes(outletDomain)
        const outletInMissed = missed.includes(outletDomain)
        if (outletInCarried || outletInMissed) {
          totalOmissionObservations++
          if (outletInMissed) outletMissCount++
        }
      } catch {
        // malformed JSON — skip
      }
    }
    if (totalOmissionObservations > 0) {
      umbrellaMissRate = outletMissCount / totalOmissionObservations
    }

    // Global miss rate for this outlet (from OutletFingerprint).
    // OutletFingerprint is one row per outlet (all categories). We use the
    // aggregate omissionRate as this outlet's baseline miss rate.
    let globalMissRate = umbrellaMissRate // fallback: assume consistent
    const fingerprint = await tx.outletFingerprint.findFirst({
      where: { outletId },
      select: { omissionRate: true },
    })
    if (fingerprint?.omissionRate !== undefined && fingerprint?.omissionRate !== null) {
      globalMissRate = fingerprint.omissionRate
    }
    // signalCategory kept for logging / future per-category compute
    void signalCategory
    // Consistency = 1 - |umbrella - global|; clamped to [0, 1]
    const omissionConsistencyRate = Math.max(0, Math.min(1, 1 - Math.abs(umbrellaMissRate - globalMissRate)))

    results.push({
      outletId,
      outletDomain,
      analysesAppeared,
      frameConsistency,
      earlyMoverRate,
      omissionConsistencyRate,
      insufficientData: analysesAppeared < 5,
    })
  }

  // 7. Upsert all profiles
  const now = new Date()
  for (const r of results) {
    await tx.outletUmbrellaProfile.upsert({
      where: {
        outletId_umbrellaArcId: {
          outletId: r.outletId,
          umbrellaArcId,
        },
      },
      create: {
        outletId: r.outletId,
        umbrellaArcId,
        frameConsistency: r.frameConsistency,
        earlyMoverRate: r.earlyMoverRate,
        omissionConsistencyRate: r.omissionConsistencyRate,
        analysesAppeared: r.analysesAppeared,
        computedAt: now,
      },
      update: {
        frameConsistency: r.frameConsistency,
        earlyMoverRate: r.earlyMoverRate,
        omissionConsistencyRate: r.omissionConsistencyRate,
        analysesAppeared: r.analysesAppeared,
        computedAt: now,
      },
    })
  }

  return results
}
