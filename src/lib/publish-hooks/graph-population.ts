/**
 * Knowledge graph population (System D).
 *
 * Builds GraphNode + GraphEdge records as stories are analyzed and signals
 * land. Every node is tagged with streamType so the visualization can filter
 * or color by stream:
 *   narrative     — story clusters, outlets, entities, umbrella arcs
 *   ground_truth  — raw signal nodes, data source nodes
 *   psychological — social signal nodes, social channel nodes (Phase 9)
 *
 * Node IDs are deterministic strings so upserts are idempotent without needing
 * a compound unique constraint:
 *   cluster_<clusterId>
 *   entity_<entitySlug>
 *   outlet_<outletDomain>
 *   umbrella_<umbrellaArcId>
 *   rawsignal_<rawSignalLayerId>
 *   socialsignal_<socialSignalId>
 *   datasource_<signalSource>
 *
 * Edge IDs: <edgeType>__<sourceId>__<targetId>
 *
 * No data is ever deleted from graph tables — the append-only rule applies
 * here just as it does to ArcTimelineEvent.
 */

import { prisma } from '@/lib/db'

type StreamType = 'narrative' | 'ground_truth' | 'psychological'
type NodeType =
  | 'story_cluster'
  | 'outlet'
  | 'entity'
  | 'raw_signal'
  | 'umbrella_arc'
  | 'data_source'
  | 'signal_category'
  | 'geographic_region'
  | 'social_signal'
type EdgeType =
  | 'mentions'
  | 'corroborates'
  | 'contradicts'
  | 'precedes'
  | 'follows'
  | 'contains'
  | 'fingerprint_match'
  | 'entity_match'
  | 'geographic_overlap'
  | 'temporal_proximity'

// ── Deterministic ID helpers ──────────────────────────────────────────
function clusterNodeId(clusterId: string) { return `cluster_${clusterId}` }
function entityNodeId(slug: string) { return `entity_${slug}` }
function outletNodeId(domain: string) { return `outlet_${domain}` }
function umbrellaNodeId(umbrellaArcId: string) { return `umbrella_${umbrellaArcId}` }
function rawSignalNodeId(rawSignalLayerId: string) { return `rawsignal_${rawSignalLayerId}` }
function dataSourceNodeId(signalSource: string) { return `datasource_${signalSource}` }
function edgeId(type: EdgeType, sourceId: string, targetId: string) {
  return `${type}__${sourceId}__${targetId}`
}

// ── Low-level upsert ──────────────────────────────────────────────────
async function upsertNode(params: {
  id: string
  nodeType: NodeType
  nodeLabel: string
  nodeWeight?: number
  metadata?: Record<string, unknown>
  streamType?: StreamType | null
}): Promise<void> {
  try {
    await prisma.graphNode.upsert({
      where: { id: params.id },
      create: {
        id: params.id,
        nodeType: params.nodeType,
        nodeLabel: params.nodeLabel,
        nodeWeight: params.nodeWeight ?? 1.0,
        metadata: (params.metadata ?? {}) as object,
        streamType: params.streamType ?? null,
      },
      update: {
        // Keep label/metadata current; do not overwrite streamType once set.
        nodeLabel: params.nodeLabel,
        metadata: (params.metadata ?? {}) as object,
        ...(params.nodeWeight !== undefined ? { nodeWeight: params.nodeWeight } : {}),
      },
    })
  } catch (err) {
    console.warn(
      `[graph] upsertNode failed (${params.id}):`,
      err instanceof Error ? err.message : err,
    )
  }
}

async function upsertEdge(params: {
  edgeType: EdgeType
  sourceNodeId: string
  targetNodeId: string
  edgeWeight: number
  temporalProximityHours?: number | null
}): Promise<void> {
  const id = edgeId(params.edgeType, params.sourceNodeId, params.targetNodeId)
  try {
    await prisma.graphEdge.upsert({
      where: { id },
      create: {
        id,
        sourceNodeId: params.sourceNodeId,
        targetNodeId: params.targetNodeId,
        edgeType: params.edgeType,
        edgeWeight: params.edgeWeight,
        temporalProximityHours: params.temporalProximityHours ?? null,
      },
      update: {
        // Refresh weight if the caller supplies a newer one. Otherwise no-op.
        edgeWeight: params.edgeWeight,
      },
    })
  } catch (err) {
    console.warn(
      `[graph] upsertEdge failed (${id}):`,
      err instanceof Error ? err.message : err,
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PIPELINE COMPLETION — narrative stream
// Called at the end of every pipeline run via runPublishHooks().
// ═════════════════════════════════════════════════════════════════════════

export interface PipelineGraphInput {
  storyId: string
  storyClusterId: string
  umbrellaArcId: string | null
  clusterHeadline: string
  clusterSignalCategory: string | null
  entityIds: string[]           // Entity row ids from populateStoryEntities
  outletDomains: string[]       // unique outlet domains from Source rows
  primaryCountry: string | null
}

export async function populatePipelineGraph(input: PipelineGraphInput): Promise<void> {
  try {
    // 1. StoryCluster node (narrative)
    const clusterId = clusterNodeId(input.storyClusterId)
    await upsertNode({
      id: clusterId,
      nodeType: 'story_cluster',
      nodeLabel: input.clusterHeadline.substring(0, 200),
      metadata: {
        signalCategory: input.clusterSignalCategory,
        primaryCountry: input.primaryCountry,
      },
      streamType: 'narrative',
    })

    // 2. Umbrella arc node (if this cluster is nested in an umbrella)
    if (input.umbrellaArcId) {
      const umbrella = await prisma.umbrellaArc.findUnique({
        where: { id: input.umbrellaArcId },
        select: { name: true, signalCategory: true },
      })
      if (umbrella) {
        const umbrellaId = umbrellaNodeId(input.umbrellaArcId)
        await upsertNode({
          id: umbrellaId,
          nodeType: 'umbrella_arc',
          nodeLabel: umbrella.name,
          metadata: { signalCategory: umbrella.signalCategory },
          streamType: 'narrative',
        })
        await upsertEdge({
          edgeType: 'contains',
          sourceNodeId: umbrellaId,
          targetNodeId: clusterId,
          edgeWeight: 0.9,
        })
      }
    }

    // 3. Entity nodes + mentions edges (cluster → entity)
    if (input.entityIds.length > 0) {
      const entities = await prisma.entity.findMany({
        where: { id: { in: input.entityIds } },
        select: { id: true, slug: true, name: true, type: true },
      })
      for (const e of entities) {
        const entityNodeIdStr = entityNodeId(e.slug)
        await upsertNode({
          id: entityNodeIdStr,
          nodeType: 'entity',
          nodeLabel: e.name,
          metadata: { type: e.type, slug: e.slug },
          streamType: 'narrative',
        })
        await upsertEdge({
          edgeType: 'mentions',
          sourceNodeId: clusterId,
          targetNodeId: entityNodeIdStr,
          edgeWeight: 0.6,
        })
      }
    }

    // 4. Outlet nodes + contains edges (cluster → outlet)
    if (input.outletDomains.length > 0) {
      const outlets = await prisma.outlet.findMany({
        where: { domain: { in: input.outletDomains } },
        select: { id: true, domain: true, name: true, tier: true, region: true },
      })
      const outletByDomain = new Map(outlets.map((o) => [o.domain, o]))
      for (const domain of input.outletDomains) {
        const outlet = outletByDomain.get(domain)
        const label = outlet?.name ?? domain
        const nodeId = outletNodeId(domain)
        await upsertNode({
          id: nodeId,
          nodeType: 'outlet',
          nodeLabel: label,
          metadata: {
            tier: outlet?.tier ?? 'unclassified',
            region: outlet?.region ?? null,
            domain,
          },
          streamType: 'narrative',
        })
        await upsertEdge({
          edgeType: 'contains',
          sourceNodeId: clusterId,
          targetNodeId: nodeId,
          edgeWeight: 0.4,
        })
      }
    }
  } catch (err) {
    console.warn(
      '[graph] populatePipelineGraph failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ═════════════════════════════════════════════════════════════════════════
// RAW SIGNAL WRITE — ground_truth stream
// Called after every RawSignalLayer insert in runner.ts.
// ═════════════════════════════════════════════════════════════════════════

export interface RawSignalGraphInput {
  rawSignalLayerId: string
  storyClusterId: string
  signalType: string
  signalSource: string
  divergenceFlag: boolean
  divergenceDescription: string | null
  confidenceLevel: 'low' | 'medium' | 'high'
  haikuSummary: string
  captureDate: Date
}

export async function populateRawSignalGraph(input: RawSignalGraphInput): Promise<void> {
  try {
    const clusterId = clusterNodeId(input.storyClusterId)
    const signalId = rawSignalNodeId(input.rawSignalLayerId)
    const sourceId = dataSourceNodeId(input.signalSource)

    // Raw signal node (ground_truth stream)
    await upsertNode({
      id: signalId,
      nodeType: 'raw_signal',
      nodeLabel: input.haikuSummary.substring(0, 200),
      metadata: {
        rawSignalLayerId: input.rawSignalLayerId,
        signalType: input.signalType,
        signalSource: input.signalSource,
        divergenceFlag: input.divergenceFlag,
        confidenceLevel: input.confidenceLevel,
        capturedAt: input.captureDate.toISOString(),
      },
      streamType: 'ground_truth',
      nodeWeight: input.divergenceFlag ? 1.5 : 1.0,
    })

    // Data source node (ground_truth stream) — one per integration
    await upsertNode({
      id: sourceId,
      nodeType: 'data_source',
      nodeLabel: input.signalSource,
      metadata: { signalType: input.signalType },
      streamType: 'ground_truth',
    })

    // data_source → raw_signal (contains)
    await upsertEdge({
      edgeType: 'contains',
      sourceNodeId: sourceId,
      targetNodeId: signalId,
      edgeWeight: 0.5,
    })

    // cluster ↔ raw_signal: divergence flag drives edge type.
    // divergenceFlag=true → contradicts (the narrative missed/mis-framed this)
    // divergenceFlag=false → corroborates (raw data backs up the narrative)
    // The highest-priority signal — contradicts edges animate red in the viz.
    const edgeType: EdgeType = input.divergenceFlag ? 'contradicts' : 'corroborates'
    const edgeWeight = input.divergenceFlag ? 1.0 : 0.8
    await upsertEdge({
      edgeType,
      sourceNodeId: signalId,
      targetNodeId: clusterId,
      edgeWeight,
    })
  } catch (err) {
    console.warn(
      '[graph] populateRawSignalGraph failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
