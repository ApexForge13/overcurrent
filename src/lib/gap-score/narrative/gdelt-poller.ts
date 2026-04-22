/**
 * GDELT narrative poller.
 *
 * Polls a batch of query terms (featured-set tickers/names) against the
 * GDELT DOC API, runs entity extraction on returned articles, writes
 * EntityObservation rows with sourceType='gdelt_article'.
 *
 * Polling strategy:
 *   - 15-min scheduled tick (BullMQ repeatable)
 *   - For each query term, fetch ~50 articles
 *   - Dedup via EntityObservation unique constraint (DB-side)
 *   - Cost: one GDELT call per query term per tick
 *
 * For 1c.2b.1 scope: query terms come from the featured set. Scale-up to
 * broader entity universe happens post-validation of rate limits.
 */

import type { PrismaClient } from '@prisma/client'
import { searchGdeltGlobal, type GdeltResult } from '@/ingestion/gdelt'
import { getAliasIndex } from '@/lib/entity-extraction/alias-index'
import { extractEntities } from '@/lib/entity-extraction/extract-from-text'
import { writeObservations, type ObservationInput } from './observation-writer'

const SOURCE_TYPE = 'gdelt_article'

export interface GdeltPollResult {
  queryCount: number
  articlesFetched: number
  observationsAttempted: number
  observationsInserted: number
  unmatchedArticles: number
}

/**
 * Poll a list of query terms. Each term → one GDELT fetch → entity
 * extraction → write observations.
 */
export async function pollGdeltForQueries(
  prisma: PrismaClient,
  queries: string[],
): Promise<GdeltPollResult> {
  const aliasIndex = await getAliasIndex(prisma)
  let articlesFetched = 0
  let unmatchedArticles = 0
  const observations: ObservationInput[] = []

  for (const query of queries) {
    let articles: GdeltResult[] = []
    try {
      articles = await searchGdeltGlobal(query)
    } catch {
      articles = []
    }
    articlesFetched += articles.length
    for (const a of articles) {
      const text = a.title
      const hits = extractEntities(text, aliasIndex)
      if (hits.length === 0) {
        unmatchedArticles++
        continue
      }
      const observedAt = parseSeenDate(a.seendate)
      for (const h of hits) {
        observations.push({
          entityId: h.entityId,
          sourceType: SOURCE_TYPE,
          outlet: a.domain || null,
          sourceUrl: a.url,
          title: a.title || null,
          engagement: null,
          observedAt,
        })
      }
    }
  }

  const writeResult = await writeObservations(prisma, observations)
  return {
    queryCount: queries.length,
    articlesFetched,
    observationsAttempted: writeResult.attempted,
    observationsInserted: writeResult.inserted,
    unmatchedArticles,
  }
}

/**
 * GDELT's `seendate` field format is "YYYYMMDDTHHMMSSZ" (e.g.,
 * "20260420T091500Z"). Fall back to now() when unparseable.
 */
export function parseSeenDate(raw: string): Date {
  if (!raw || raw.length < 15) return new Date()
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d : new Date()
}

/**
 * Build a list of GDELT query terms from featured-set TrackedEntity rows.
 * Combines the ticker identifier with the first 2 aliases to cast a
 * reasonable net per entity. Capped at ~30 entities to keep the fetch
 * count bounded.
 */
export async function buildFeaturedSetQueries(
  prisma: PrismaClient,
  limit = 30,
): Promise<string[]> {
  const entities = await prisma.trackedEntity.findMany({
    where: { isFeatured: true, active: true },
    select: { identifier: true, name: true, entityStrings: true },
    take: limit,
  })
  const queries: string[] = []
  for (const e of entities) {
    // Prefer full name as query term — higher signal-to-noise than raw ticker
    if (e.name && e.name.length > 2) {
      queries.push(e.name)
    } else {
      queries.push(e.identifier)
    }
  }
  return queries
}
