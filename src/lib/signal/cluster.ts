/**
 * Story clustering.
 *
 * Goal: match a new analysis to an existing parent StoryCluster if it's
 * about the same story. Otherwise create a new cluster.
 *
 * Match criteria (both must pass OR admin used clusterOverride='attach'):
 *   - ≥60% entity overlap with cluster's canonical entities, AND
 *   - ≥0.55 headline cosine similarity
 *
 * Manual override:
 *   - clusterOverride='new': always create new cluster, skip matching
 *   - clusterOverride='attach' + attachToClusterId: force-attach to that cluster
 *
 * MIN_SIGNAL: clustering works at N=1. Arc generation requires 3+ analyses.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { prisma } from '@/lib/db'
import type { SignalCategory } from './signal-category'

// ── Entity extraction ──────────────────────────────────────────────

const ENTITY_SYSTEM_PROMPT = `Extract named entities from a news story for clustering purposes.

Return ONLY a JSON array of 5-15 distinct entities. Prioritize in this order:
1. Country names (e.g., "Hungary", "Iran", "Ukraine")
2. Political figures (e.g., "Orbán", "Trump", "Netanyahu")
3. Organizations (e.g., "NATO", "Hamas", "Fed")
4. Place names (e.g., "Hormuz", "Budapest")
5. Key concepts with proper nouns (e.g., "Tisza Party", "Article 5")

DO NOT include common nouns (election, war, protest, crisis, deal).
DO NOT include dates or numbers.
Use canonical spellings (not diacritics): "Orban" not "Orbán", "Turkey" not "Türkiye".

Response format (JSON array of strings only):
["Entity1", "Entity2", "Entity3"]`

export interface EntityExtraction {
  entities: string[]
  costUsd: number
}

/** Extract ~5-15 canonical entities from a headline/synopsis for clustering. */
export async function extractEntities(
  headline: string,
  synopsis: string,
  storyId?: string,
): Promise<EntityExtraction> {
  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: ENTITY_SYSTEM_PROMPT,
      userPrompt: `${headline}\n\n${synopsis}`,
      agentType: 'cluster_entities',
      maxTokens: 256,
      storyId,
    })

    let parsed: string[]
    try {
      parsed = parseJSON<string[]>(result.text)
    } catch {
      // If it returned {entities: [...]} wrap
      const wrapped = parseJSON<{ entities: string[] }>(result.text)
      parsed = wrapped?.entities ?? []
    }

    const entities = (Array.isArray(parsed) ? parsed : [])
      .filter((e): e is string => typeof e === 'string' && e.length > 0)
      .map((e) => e.trim())
      .filter((e) => e.length > 1)
      .slice(0, 15)

    return { entities, costUsd: result.costUsd }
  } catch (err) {
    console.error('[cluster] Entity extraction failed:', err instanceof Error ? err.message : err)
    return { entities: [], costUsd: 0 }
  }
}

// ── Similarity scoring ─────────────────────────────────────────────

/** Lowercase + strip diacritics for case-insensitive entity comparison. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Entity overlap: fraction of new entities that appear in existing set. */
export function entityOverlapScore(newEntities: string[], existingEntities: string[]): number {
  if (newEntities.length === 0 || existingEntities.length === 0) return 0
  const existingNorm = new Set(existingEntities.map(normalize))
  const matches = newEntities.filter((e) => existingNorm.has(normalize(e))).length
  return matches / newEntities.length
}

/** Simple word-overlap headline similarity (good enough; no embedding needed). */
export function headlineSimilarity(a: string, b: string): number {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
    'with', 'by', 'from', 'is', 'was', 'are', 'were', 'after', 'before', 'as',
    'that', 'this', 'it', 'its', 'has', 'have', 'had', 'will', 'would', 'be',
    'been', 'being', 'new', 'old',
  ])
  function tokens(s: string): Set<string> {
    return new Set(
      normalize(s)
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w)),
    )
  }
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  // Jaccard-like: intersection / union (order-independent)
  const union = ta.size + tb.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ── Cluster match + create ────────────────────────────────────────

export interface ClusterMatchOptions {
  clusterOverride?: 'new' | 'attach' | null
  attachToClusterId?: string | null
  /** Thresholds are exposed for testing; production uses defaults. */
  entityThreshold?: number
  headlineThreshold?: number
  /** If provided, only consider clusters created in the last N days (saves DB work). */
  recencyDays?: number
}

export interface ClusterMatchResult {
  clusterId: string
  isNewCluster: boolean
  matchedReason: 'override_attach' | 'override_new' | 'entity+headline_match' | 'no_match_created'
  entityScore?: number
  headlineScore?: number
}

const DEFAULT_ENTITY_THRESHOLD = 0.6
const DEFAULT_HEADLINE_THRESHOLD = 0.55
const DEFAULT_RECENCY_DAYS = 30 // Don't match clusters older than 30 days

/**
 * Find or create a StoryCluster for a new analysis.
 *
 * @param headline  - The analysis headline
 * @param entities  - Canonical entities extracted via extractEntities()
 * @param options   - Override flags + tuning knobs
 */
export async function findOrCreateCluster(
  headline: string,
  entities: string[],
  signalCategory: SignalCategory | null,
  firstArticlePublishedAt: Date | null,
  options: ClusterMatchOptions = {},
): Promise<ClusterMatchResult> {
  const {
    clusterOverride = null,
    attachToClusterId = null,
    entityThreshold = DEFAULT_ENTITY_THRESHOLD,
    headlineThreshold = DEFAULT_HEADLINE_THRESHOLD,
    recencyDays = DEFAULT_RECENCY_DAYS,
  } = options

  // Path 1: admin forced attach to specific cluster
  if (clusterOverride === 'attach' && attachToClusterId) {
    return { clusterId: attachToClusterId, isNewCluster: false, matchedReason: 'override_attach' }
  }

  // Path 2: admin forced new cluster
  if (clusterOverride === 'new') {
    const newCluster = await createCluster(headline, entities, signalCategory, firstArticlePublishedAt)
    return { clusterId: newCluster.id, isNewCluster: true, matchedReason: 'override_new' }
  }

  // Path 3: auto-match against recent clusters
  const recencyCutoff = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000)
  const candidates = await prisma.storyCluster.findMany({
    where: { lastUpdatedAt: { gte: recencyCutoff } },
    orderBy: { lastUpdatedAt: 'desc' },
    take: 100, // cap: more than enough for 30-day window at current volume
  })

  let bestMatch: { cluster: typeof candidates[0]; entityScore: number; headlineScore: number } | null = null

  for (const c of candidates) {
    const existingEntities: string[] = (() => {
      try { return JSON.parse(c.clusterKeywords) } catch { return [] }
    })()

    const entityScore = entityOverlapScore(entities, existingEntities)
    const headlineScore = headlineSimilarity(headline, c.clusterHeadline)

    if (entityScore >= entityThreshold && headlineScore >= headlineThreshold) {
      if (!bestMatch || (entityScore + headlineScore) > (bestMatch.entityScore + bestMatch.headlineScore)) {
        bestMatch = { cluster: c, entityScore, headlineScore }
      }
    }
  }

  if (bestMatch) {
    return {
      clusterId: bestMatch.cluster.id,
      isNewCluster: false,
      matchedReason: 'entity+headline_match',
      entityScore: bestMatch.entityScore,
      headlineScore: bestMatch.headlineScore,
    }
  }

  // Path 4: no match — create new cluster
  const newCluster = await createCluster(headline, entities, signalCategory, firstArticlePublishedAt)
  return { clusterId: newCluster.id, isNewCluster: true, matchedReason: 'no_match_created' }
}

/** Create a brand new StoryCluster. */
async function createCluster(
  headline: string,
  entities: string[],
  signalCategory: SignalCategory | null,
  firstArticlePublishedAt: Date | null,
) {
  return prisma.storyCluster.create({
    data: {
      clusterHeadline: headline,
      clusterKeywords: JSON.stringify(entities),
      signalCategory,
      firstDetectedAt: firstArticlePublishedAt ?? new Date(),
      currentPhase: 'first_wave',
      totalAnalysesRun: 0,
    },
  })
}

/** Update cluster bookkeeping after an analysis is assigned to it. */
export async function bumpClusterOnAnalysis(clusterId: string, _analyzedAt: Date = new Date()): Promise<void> {
  // Load once to re-evaluate currentPhase using firstDetectedAt
  const cluster = await prisma.storyCluster.findUnique({ where: { id: clusterId } })
  if (!cluster) return

  // Recompute currentPhase based on wall-clock time since firstDetectedAt
  const { phaseFromDates } = await import('./phase')
  const currentPhase = phaseFromDates(cluster.firstDetectedAt)

  await prisma.storyCluster.update({
    where: { id: clusterId },
    data: {
      totalAnalysesRun: { increment: 1 },
      lastUpdatedAt: new Date(),
      currentPhase,
    },
  })
}
