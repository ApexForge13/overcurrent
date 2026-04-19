/**
 * Publish-time hook orchestrator (Phase 2).
 *
 * Called fire-and-forget from pipeline.ts after signal tracking completes.
 * Runs in order:
 *   1. populateStoryGeography      — Story.coordinatesJson + primaryCountry
 *   2. populateStoryEntities        — Entity + EntityMention rows
 *   3. populatePipelineGraph        — GraphNode + GraphEdge (narrative stream)
 *   4. writeAnalysisRunEvent        — ArcTimelineEvent (narrative stream)
 *
 * Pipeline integrity rule: every step must fail gracefully. A failure in
 * one step must not prevent later steps from running. Under no circumstance
 * is analysis delivery blocked by a failure in this orchestrator.
 */

import { prisma } from '@/lib/db'
import { populateStoryGeography } from './geographic-extraction'
import { populateStoryEntities } from './entity-extraction'
import { populatePipelineGraph } from './graph-population'
import { writeAnalysisRunEvent } from './arc-timeline'

/**
 * Run all publish-time side-effects for a story that has just completed the
 * pipeline. Safe to call from a fire-and-forget IIFE.
 */
export async function runPublishHooks(storyId: string): Promise<void> {
  console.log(`[publish-hooks] SESSION4_PHASE2 runPublishHooks START for story=${storyId.substring(0, 8)}`)
  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: {
        id: true,
        headline: true,
        synopsis: true,
        storyClusterId: true,
        umbrellaArcId: true,
        signalCategory: true,
        storyPhase: true,
        analysisType: true,
        sourceCount: true,
        currentVersion: true,
      },
    })
    if (!story) {
      console.warn(`[publish-hooks] Story ${storyId} not found; skipping`)
      return
    }
    console.log(
      `[publish-hooks] SESSION4_PHASE2 story loaded: cluster=${story.storyClusterId?.substring(0, 8) ?? 'null'}, umbrella=${story.umbrellaArcId?.substring(0, 8) ?? 'null'}, signalCategory=${story.signalCategory ?? 'null'}`,
    )

    // Step 1: geographic extraction (always, even for non-clustered stories
    // because standalone one-offs still need coordinates for the map view)
    console.log(`[publish-hooks] SESSION4_PHASE2 Step 1 geography starting`)
    await populateStoryGeography(storyId).catch((err) => {
      console.warn('[publish-hooks] step 1 (geography) failed:', err instanceof Error ? err.message : err)
    })
    console.log(`[publish-hooks] SESSION4_PHASE2 Step 1 geography complete`)

    // Remaining steps require a cluster — standalone stories without a cluster
    // skip graph/timeline population for Phase 2 scope (Phase 18 adds
    // a cluster-less pathway for one-off timeline events).
    if (!story.storyClusterId) {
      // Entity extraction can still run off headline/synopsis even without a cluster;
      // but the cluster keyword list is the richer signal, so without it we'd be
      // extracting from a much smaller candidate set. Phase 2 skips in this case.
      console.log(`[publish-hooks] SESSION4_PHASE2 no cluster — Steps 2-4 skipped`)
      return
    }

    // Step 2: entity extraction + mentions
    console.log(`[publish-hooks] SESSION4_PHASE2 Step 2 entities starting`)
    const entityIds = await populateStoryEntities(storyId).catch((err) => {
      console.warn('[publish-hooks] step 2 (entities) failed:', err instanceof Error ? err.message : err)
      return [] as string[]
    })
    console.log(`[publish-hooks] SESSION4_PHASE2 Step 2 entities complete — ${entityIds.length} entities`)

    // Step 3: graph population — need cluster headline + outlet list
    const [cluster, sources] = await Promise.all([
      prisma.storyCluster.findUnique({
        where: { id: story.storyClusterId },
        select: { clusterHeadline: true, signalCategory: true, canonicalSignalCategory: true },
      }),
      prisma.source.findMany({
        where: { storyId },
        select: { url: true },
      }),
    ])

    const outletDomains = Array.from(
      new Set(
        sources
          .map((s) => {
            try {
              return new URL(s.url).hostname.replace(/^www\./, '')
            } catch {
              return null
            }
          })
          .filter((d): d is string => !!d),
      ),
    )

    // Reload story to pick up the primaryCountry value populateStoryGeography may have set.
    const refreshed = await prisma.story.findUnique({
      where: { id: storyId },
      select: { primaryCountry: true },
    })

    if (cluster) {
      console.log(`[publish-hooks] SESSION4_PHASE2 Step 3 graph starting — ${outletDomains.length} outlets`)
      await populatePipelineGraph({
        storyId: story.id,
        storyClusterId: story.storyClusterId,
        umbrellaArcId: story.umbrellaArcId,
        clusterHeadline: cluster.clusterHeadline,
        clusterSignalCategory: cluster.canonicalSignalCategory ?? cluster.signalCategory,
        entityIds,
        outletDomains,
        primaryCountry: refreshed?.primaryCountry ?? null,
      }).catch((err) => {
        console.warn('[publish-hooks] step 3 (graph) failed:', err instanceof Error ? err.message : err)
      })
      console.log(`[publish-hooks] SESSION4_PHASE2 Step 3 graph complete`)
    }

    // Step 4: analysis_run timeline event
    console.log(`[publish-hooks] SESSION4_PHASE2 Step 4 timeline event starting`)
    await writeAnalysisRunEvent({
      storyId: story.id,
      storyClusterId: story.storyClusterId,
      umbrellaArcId: story.umbrellaArcId,
      headline: story.headline,
      sourceCount: story.sourceCount,
      signalCategory: story.signalCategory,
      storyPhase: story.storyPhase,
      analysisType: story.analysisType,
      versionNumber: story.currentVersion,
    }).catch((err) => {
      console.warn('[publish-hooks] step 4 (timeline) failed:', err instanceof Error ? err.message : err)
    })
    console.log(`[publish-hooks] SESSION4_PHASE2 Step 4 timeline event complete`)

    console.log(
      `[publish-hooks] SESSION4_PHASE2 COMPLETED for story ${storyId.substring(0, 8)} — entities=${entityIds.length}, outlets=${outletDomains.length}`,
    )
  } catch (err) {
    // Catch-all — never let this bubble up past the orchestrator.
    console.error(
      '[publish-hooks] orchestrator failed (non-blocking):',
      err instanceof Error ? err.message : err,
      err instanceof Error && err.stack ? `\n${err.stack}` : '',
    )
  }
}
