/**
 * Signal tracking orchestrator.
 *
 * Called from pipeline.ts AFTER the main story/children are saved to DB.
 * Runs everything that writes to the predictive signal layer:
 *   1. Classify signalCategory (Haiku)
 *   2. Extract entities (Haiku)
 *   3. Find or create StoryCluster
 *   4. Compute storyPhase
 *   5. Update Story with cluster/phase/category
 *   6. Bump cluster stats
 *   7. Detect fact omissions (Haiku over fetched content)
 *   8. Save FactOmission rows
 *   9. Write OutletAppearance rows
 *  10. Write FramingTag rows
 *  11. Recompute OutletFingerprints for affected outlets
 *  12. Recompute StoryCategoryPattern
 *  13. If cluster ≥3 analyses across ≥2 phases: regenerate NarrativeArc
 *  14. If analysis is first_wave: compute PredictiveSignal
 *
 * ALL operations are wrapped in try/catch. Signal tracking failures NEVER
 * block user-facing analysis results — the story is already saved and the
 * public site works fine without signal data.
 */

import { prisma } from '@/lib/db'
import { normalizeDomain } from '@/lib/outlet-map'
import { classifySignalCategory } from './signal-category'
import { extractEntities, findOrCreateCluster, bumpClusterOnAnalysis } from './cluster'
import { phaseFromDates } from './phase'
import { writeOutletAppearances, type AppearanceInput } from './outlet-appearance'
import { writeFramingTags, type FramingTagInput } from './framing-tag'
import { detectFactOmissions, saveFactOmissions } from './fact-omission'
import { recomputeFingerprintsForStory } from './outlet-fingerprint'
import { recomputeCategoryPattern } from './category-pattern'
import { regenerateNarrativeArc } from './narrative-arc'
import { computePredictiveSignal } from './predictive-signal'
import { recomputeUmbrellaProfiles } from '@/lib/umbrella-outlet-profile'
import { recomputeClusterCompleteness } from '@/lib/arc-completeness'

export interface SignalTrackingInput {
  storyId: string
  headline: string
  synopsis: string
  query: string
  /** Earliest article publishedAt across this analysis's sources. */
  firstArticlePublishedAt: Date | null
  /** Admin override: 'new' forces new cluster, 'attach' requires attachToClusterId. */
  clusterOverride?: 'new' | 'attach' | null
  attachToClusterId?: string | null
  /** Sources with full content for fact-omission detection. */
  sources: Array<{
    outletDomain: string
    title: string
    content?: string
    region?: string
    publishedAt?: Date | null
  }>
  /** Framing angles the synthesis extracted, if available. */
  framings?: Array<{
    outletDomain: string
    framingAngle: string
    isDominant?: boolean
  }>
}

export interface SignalTrackingResult {
  clusterId: string | null
  isNewCluster: boolean
  storyPhase: string
  signalCategory: string | null
  appearancesWritten: number
  factOmissionsDetected: number
  framingTagsWritten: number
  fingerprintsRecomputed: number
  predictiveSignalGenerated: boolean
  narrativeArcGenerated: boolean
  totalCostUsd: number
  errors: string[]
}

/**
 * Run the full signal tracking layer for a completed analysis.
 * Idempotent in the sense that rerunning won't corrupt data (clusters
 * are found-or-created, appearances are new inserts, fingerprints are upserts).
 */
export async function runSignalTracking(
  input: SignalTrackingInput,
): Promise<SignalTrackingResult> {
  const result: SignalTrackingResult = {
    clusterId: null,
    isNewCluster: false,
    storyPhase: 'first_wave',
    signalCategory: null,
    appearancesWritten: 0,
    factOmissionsDetected: 0,
    framingTagsWritten: 0,
    fingerprintsRecomputed: 0,
    predictiveSignalGenerated: false,
    narrativeArcGenerated: false,
    totalCostUsd: 0,
    errors: [],
  }

  console.log(`\n━━━ [signal] Starting tracking for story ${input.storyId} ━━━`)

  // ── 1. Classify signalCategory ──
  let signalCategory: string | null = null
  try {
    const catResult = await classifySignalCategory(input.headline, input.synopsis, input.storyId)
    signalCategory = catResult.signalCategory
    result.signalCategory = catResult.signalCategory
    result.totalCostUsd += catResult.costUsd
    console.log(`[signal] signalCategory: ${catResult.signalCategory} (conf ${catResult.confidence.toFixed(2)})`)
  } catch (err) {
    result.errors.push(`signalCategory: ${err instanceof Error ? err.message : err}`)
  }

  // ── 2. Extract entities ──
  let entities: string[] = []
  try {
    const ext = await extractEntities(input.headline, input.synopsis, input.storyId)
    entities = ext.entities
    result.totalCostUsd += ext.costUsd
    console.log(`[signal] entities: ${entities.join(', ')}`)
  } catch (err) {
    result.errors.push(`entities: ${err instanceof Error ? err.message : err}`)
  }

  // ── 3. Find or create cluster ──
  let clusterId: string | null = null
  let isNewCluster = false
  try {
    const match = await findOrCreateCluster(
      input.headline,
      entities,
      signalCategory as any,
      input.firstArticlePublishedAt,
      {
        clusterOverride: input.clusterOverride ?? null,
        attachToClusterId: input.attachToClusterId ?? null,
      },
    )
    clusterId = match.clusterId
    isNewCluster = match.isNewCluster
    result.clusterId = clusterId
    result.isNewCluster = isNewCluster
    console.log(`[signal] cluster: ${isNewCluster ? 'NEW' : 'matched'} ${clusterId} (${match.matchedReason})`)
  } catch (err) {
    result.errors.push(`cluster: ${err instanceof Error ? err.message : err}`)
  }

  // ── 4. Compute storyPhase ──
  let cluster: { firstDetectedAt: Date } | null = null
  if (clusterId) {
    try {
      cluster = await prisma.storyCluster.findUnique({
        where: { id: clusterId },
        select: { firstDetectedAt: true },
      })
    } catch {}
  }
  const storyPhase = cluster ? phaseFromDates(cluster.firstDetectedAt) : 'first_wave'
  result.storyPhase = storyPhase
  console.log(`[signal] phase: ${storyPhase}`)

  // ── 5. Update Story with cluster/phase/category ──
  try {
    await prisma.story.update({
      where: { id: input.storyId },
      data: {
        storyClusterId: clusterId,
        storyPhase,
        signalCategory,
      },
    })
  } catch (err) {
    result.errors.push(`story.update: ${err instanceof Error ? err.message : err}`)
  }

  // ── 6. Bump cluster stats ──
  if (clusterId) {
    try {
      await bumpClusterOnAnalysis(clusterId)
    } catch (err) {
      result.errors.push(`bumpCluster: ${err instanceof Error ? err.message : err}`)
    }

    // ── 6b. Recompute arc completeness for this cluster (Step 6) ──
    try {
      const level = await recomputeClusterCompleteness(clusterId)
      if (level) {
        console.log(`[signal] arcCompleteness: ${level} for cluster ${clusterId}`)
      }
    } catch (err) {
      result.errors.push(`arcCompleteness: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ── 7+8. Detect and save fact omissions ──
  try {
    const detection = await detectFactOmissions(
      {
        sources: input.sources
          .filter((s) => s.content && s.content.length >= 100)
          .map((s) => ({
            outletDomain: normalizeDomain(s.outletDomain),
            title: s.title,
            content: s.content!,
          })),
        storyHeadline: input.headline,
      },
      input.storyId,
    )
    result.totalCostUsd += detection.costUsd
    if (detection.skipped) {
      console.log(`[signal] factOmissions: skipped — ${detection.skipReason}`)
    } else {
      const saved = await saveFactOmissions({
        storyId: input.storyId,
        storyClusterId: clusterId,
        storyPhase,
        omissions: detection.omissions,
      })
      result.factOmissionsDetected = saved
      console.log(`[signal] factOmissions: ${saved} saved (${detection.sourcesAnalyzed} sources analyzed)`)
    }
  } catch (err) {
    result.errors.push(`factOmissions: ${err instanceof Error ? err.message : err}`)
  }

  // ── 9. Write OutletAppearance rows ──
  // Compute hoursFromFirstDetection for each source (relative to cluster first_detected_at)
  const clusterFirstDetected = cluster?.firstDetectedAt?.getTime() ?? null
  const appearances: AppearanceInput[] = []
  const seenDomains = new Set<string>()

  // Build framing lookup by domain for faster join
  const framingByDomain = new Map<string, { framingAngle: string; isDominant: boolean }>()
  for (const f of input.framings || []) {
    const d = normalizeDomain(f.outletDomain)
    if (!framingByDomain.has(d)) {
      framingByDomain.set(d, { framingAngle: f.framingAngle, isDominant: f.isDominant ?? false })
    }
  }

  for (const s of input.sources) {
    const domain = normalizeDomain(s.outletDomain)
    if (seenDomains.has(domain)) continue
    seenDomains.add(domain)

    const hoursFromFirstDetection =
      clusterFirstDetected && s.publishedAt
        ? (s.publishedAt.getTime() - clusterFirstDetected) / (1000 * 60 * 60)
        : null

    const framing = framingByDomain.get(domain)

    appearances.push({
      outletDomain: domain,
      storyId: input.storyId,
      storyClusterId: clusterId,
      signalCategory,
      storyPhase,
      framingAngle: framing?.framingAngle ?? null,
      wasLeadingFraming: framing?.isDominant ?? false,
      sourceTypes: null, // Can be populated later if debate output captures this
      publishedAt: s.publishedAt ?? null,
      hoursFromFirstDetection,
      isBackfilled: false,
    })
  }

  try {
    const { written } = await writeOutletAppearances(appearances)
    result.appearancesWritten = written
    console.log(`[signal] appearances: ${written} written`)
  } catch (err) {
    result.errors.push(`appearances: ${err instanceof Error ? err.message : err}`)
  }

  // ── 10. Write FramingTag rows ──
  const framingTags: FramingTagInput[] = []
  for (const [domain, f] of framingByDomain.entries()) {
    framingTags.push({
      outletDomain: domain,
      storyId: input.storyId,
      storyClusterId: clusterId,
      framingAngle: f.framingAngle,
      isDominant: f.isDominant,
      storyPhase,
      isBackfilled: false,
    })
  }
  try {
    const { written } = await writeFramingTags(framingTags)
    result.framingTagsWritten = written
    console.log(`[signal] framingTags: ${written} written`)
  } catch (err) {
    result.errors.push(`framingTags: ${err instanceof Error ? err.message : err}`)
  }

  // ── 11. Recompute OutletFingerprints for affected outlets ──
  try {
    const count = await recomputeFingerprintsForStory(input.storyId)
    result.fingerprintsRecomputed = count
    console.log(`[signal] fingerprints: ${count} recomputed`)
  } catch (err) {
    result.errors.push(`fingerprints: ${err instanceof Error ? err.message : err}`)
  }

  // ── 12. Recompute StoryCategoryPattern ──
  if (signalCategory) {
    try {
      await recomputeCategoryPattern(signalCategory as any)
      console.log(`[signal] categoryPattern: recomputed for ${signalCategory}`)
    } catch (err) {
      result.errors.push(`categoryPattern: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ── 13. Regenerate NarrativeArc if cluster has 3+ analyses ──
  if (clusterId) {
    try {
      const generated = await regenerateNarrativeArc(clusterId)
      result.narrativeArcGenerated = generated
      console.log(`[signal] narrativeArc: ${generated ? 'regenerated' : 'skipped (needs 3+ analyses, 2+ phases)'}`)
    } catch (err) {
      result.errors.push(`narrativeArc: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ── 14. Compute PredictiveSignal if first_wave ──
  if (storyPhase === 'first_wave' && clusterId && signalCategory) {
    try {
      const signal = await computePredictiveSignal(input.storyId, clusterId, signalCategory as any)
      result.predictiveSignalGenerated = !!signal
      if (signal) {
        console.log(`[signal] predictiveSignal: ${signal.predictedDominantFraming} (${signal.framingConfidencePct}% conf, ${signal.momentumFlag}, n=${signal.computedFromAnalysesCount})`)
      }
    } catch (err) {
      result.errors.push(`predictiveSignal: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ── 15. Recompute OutletUmbrellaProfile if Story is filed under an umbrella ──
  try {
    const story = await prisma.story.findUnique({
      where: { id: input.storyId },
      select: { umbrellaArcId: true },
    })
    if (story?.umbrellaArcId) {
      const profiles = await recomputeUmbrellaProfiles(story.umbrellaArcId)
      console.log(`[signal] outletUmbrellaProfile: recomputed ${profiles.length} outlets for umbrella ${story.umbrellaArcId}`)
    }
  } catch (err) {
    result.errors.push(`outletUmbrellaProfile: ${err instanceof Error ? err.message : err}`)
  }

  console.log(`━━━ [signal] Tracking complete. Cost: $${result.totalCostUsd.toFixed(4)}. Errors: ${result.errors.length} ━━━\n`)

  return result
}
