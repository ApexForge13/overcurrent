/**
 * Reddit psychological poller.
 *
 * For each featured entity, searches Reddit via the public JSON API for
 * cashtag or identifier mentions, extracts entity matches from post
 * titles, writes EntityObservation rows with sourceType='reddit_post'
 * and engagement = upvotes + comments.
 *
 * Scope: featured set only in 1c.2b.1. Expand in 1c.2b.2 once rate
 * limits validated.
 */

import type { PrismaClient } from '@prisma/client'
import { searchReddit, type RedditResult } from '@/ingestion/reddit'
import { getAliasIndex } from '@/lib/entity-extraction/alias-index'
import { extractEntities } from '@/lib/entity-extraction/extract-from-text'
import { writeObservations, type ObservationInput } from '@/lib/gap-score/narrative/observation-writer'

const SOURCE_TYPE = 'reddit_post'

export interface RedditPollResult {
  queryCount: number
  postsFetched: number
  observationsAttempted: number
  observationsInserted: number
  unmatchedPosts: number
}

export async function pollRedditForQueries(
  prisma: PrismaClient,
  queries: string[],
): Promise<RedditPollResult> {
  const aliasIndex = await getAliasIndex(prisma)
  let postsFetched = 0
  let unmatchedPosts = 0
  const observations: ObservationInput[] = []

  for (const query of queries) {
    let posts: RedditResult[] = []
    try {
      posts = await searchReddit(query)
    } catch {
      posts = []
    }
    postsFetched += posts.length
    for (const p of posts) {
      const text = `${p.title} ${p.selftext ?? ''}`
      const hits = extractEntities(text, aliasIndex)
      if (hits.length === 0) {
        unmatchedPosts++
        continue
      }
      const observedAt = new Date(p.createdUtc * 1000)
      const engagement = (p.score ?? 0) + (p.numComments ?? 0)
      for (const h of hits) {
        observations.push({
          entityId: h.entityId,
          sourceType: SOURCE_TYPE,
          outlet: p.subreddit ? `r/${p.subreddit}` : null,
          sourceUrl: p.url,
          title: p.title ?? null,
          engagement,
          observedAt,
        })
      }
    }
  }

  const writeResult = await writeObservations(prisma, observations)
  return {
    queryCount: queries.length,
    postsFetched,
    observationsAttempted: writeResult.attempted,
    observationsInserted: writeResult.inserted,
    unmatchedPosts,
  }
}

/**
 * Build featured-set cashtag queries for Reddit search. Uses the entity
 * identifier prefixed with '$' (cashtag form) as the query — yields
 * Reddit's native stock-talk threads.
 */
export async function buildFeaturedSetCashtagQueries(
  prisma: PrismaClient,
  limit = 30,
): Promise<string[]> {
  const entities = await prisma.trackedEntity.findMany({
    where: { isFeatured: true, active: true, category: { in: ['equity', 'etf', 'crypto'] } },
    select: { identifier: true },
    take: limit,
  })
  return entities.map((e) => `$${e.identifier}`)
}
