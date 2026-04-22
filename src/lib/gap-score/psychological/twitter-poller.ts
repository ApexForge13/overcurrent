/**
 * Twitter/X psychological poller.
 *
 * For each cashtag query, fetches recent engaged tweets, extracts entity
 * matches, writes EntityObservation rows with sourceType='twitter_post'
 * and engagement = likes + retweets + replies.
 *
 * Scope gating (manifest A7 — featured set only for 1c.2b.1):
 *   - pollTwitterForQueries takes an explicit list — caller decides scope
 *   - buildFeaturedSetTwitterQueries returns featured-set cashtags only
 *   - To expand beyond featured set (1c.2b.2): either pass a broader
 *     list to pollTwitterForQueries OR flip the includeAllActive flag in
 *     buildFeaturedSetTwitterQueries to relax the isFeatured filter.
 *     No code change required — configuration shift only.
 *
 * Env: TWITTER_BEARER_TOKEN. Missing token → fetchTwitterDiscourse
 * already returns [] gracefully (no heartbeat needed here; the missing-
 * key heartbeat lands in Milestone 6 centralized infra).
 */

import type { PrismaClient } from '@prisma/client'
import { fetchTwitterDiscourse, type TwitterDiscoursePost } from '@/ingestion/twitter-discourse'
import { getAliasIndex } from '@/lib/entity-extraction/alias-index'
import { extractEntities } from '@/lib/entity-extraction/extract-from-text'
import { writeObservations, type ObservationInput } from '@/lib/gap-score/narrative/observation-writer'

const SOURCE_TYPE = 'twitter_post'

export interface TwitterPollResult {
  queryCount: number
  postsFetched: number
  observationsAttempted: number
  observationsInserted: number
  unmatchedPosts: number
  keyMissing: boolean
}

export async function pollTwitterForQueries(
  prisma: PrismaClient,
  queries: string[],
  maxPerQuery = 50,
): Promise<TwitterPollResult> {
  const keyMissing = !process.env.TWITTER_BEARER_TOKEN
  if (keyMissing) {
    return {
      queryCount: queries.length,
      postsFetched: 0,
      observationsAttempted: 0,
      observationsInserted: 0,
      unmatchedPosts: 0,
      keyMissing: true,
    }
  }

  const aliasIndex = await getAliasIndex(prisma)
  let postsFetched = 0
  let unmatchedPosts = 0
  const observations: ObservationInput[] = []

  for (const query of queries) {
    let posts: TwitterDiscoursePost[] = []
    try {
      // fetchTwitterDiscourse takes a keywords array; pass query as a single-term array
      posts = await fetchTwitterDiscourse([query], maxPerQuery)
    } catch {
      posts = []
    }
    postsFetched += posts.length
    for (const p of posts) {
      const hits = extractEntities(p.content, aliasIndex)
      if (hits.length === 0) {
        unmatchedPosts++
        continue
      }
      const observedAt = new Date(p.createdAt)
      const engagement = (p.likes ?? 0) + (p.retweets ?? 0) + (p.replies ?? 0)
      for (const h of hits) {
        observations.push({
          entityId: h.entityId,
          sourceType: SOURCE_TYPE,
          outlet: p.author ? `@${p.author}` : null,
          sourceUrl: p.url,
          title: p.content.slice(0, 280),
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
    keyMissing: false,
  }
}

/**
 * Featured-set cashtag queries. Expansion hook: pass includeAllActive=true
 * to relax the isFeatured filter for broader coverage in 1c.2b.2 when
 * Twitter Basic subscription is active. No code change needed in callers
 * — this is the single flag-flip point.
 */
export async function buildFeaturedSetTwitterQueries(
  prisma: PrismaClient,
  opts: { includeAllActive?: boolean; limit?: number } = {},
): Promise<string[]> {
  const { includeAllActive = false, limit = 30 } = opts
  const where = includeAllActive
    ? { active: true, category: { in: ['equity', 'etf', 'crypto'] } }
    : { isFeatured: true, active: true, category: { in: ['equity', 'etf', 'crypto'] } }
  const entities = await prisma.trackedEntity.findMany({
    where,
    select: { identifier: true },
    take: limit,
  })
  return entities.map((e) => `$${e.identifier}`)
}
