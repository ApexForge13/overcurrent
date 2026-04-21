/**
 * Candidate generator — consumes TriggerEvent rows, enqueues Gap Score
 * candidate-compute jobs (v2 Part 2.3).
 *
 * Runs every 15 min (BullMQ repeatable on `candidate-generator` queue).
 *
 * Qualifying rules (per user's Phase 1c refinement):
 *   1. Featured entity with any trigger fired in the window → qualifies
 *      (bypasses rate limit)
 *   2. Entity with 1+ trigger of severity > 0.7 in window → qualifies
 *   3. Entity with triggers from ≥2 distinct streams in window →
 *      qualifies (dedup by stream — one stream counts once regardless
 *      of how many times it fired)
 *
 * When evaluating severity for rule 2, use the MAXIMUM across all fires
 * in the window (not just the last one). This avoids a burst of low-
 * severity narrative fires being masked by one high-severity ground-truth.
 *
 * Per-entity rate limit: 1 candidate compute per 15 min (Redis-backed TTL
 * key `candidate-limiter:<entityId>`). Featured set bypasses.
 */

import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import { getRedisConnection, getQueuePrefix } from '@/lib/queue/connection'
import { getQueue } from '@/lib/queue/queues'
import { QUEUE_NAMES } from '@/lib/queue/names'
import type { GapScoreCandidateComputeJob } from '@/lib/queue/types'

const WINDOW_HOURS = 2
const HIGH_SEVERITY_THRESHOLD = 0.7
const RATE_LIMIT_TTL_SECONDS = Number(process.env.CANDIDATE_GEN_RATE_LIMIT_MINUTES ?? 15) * 60
const DISTINCT_STREAMS_REQUIRED = 2

export interface GenerateCandidatesResult {
  candidatesQualified: number
  candidatesEnqueued: number
  candidatesRateLimited: number
  windowEventsProcessed: number
  durationMs: number
}

export async function generateCandidates(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<GenerateCandidatesResult> {
  const start = Date.now()
  const runId = `${now.getTime()}`
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000)

  // Pull all trigger events in the sliding window.
  const events = await prisma.triggerEvent.findMany({
    where: { firedAt: { gte: windowStart, lte: now } },
    select: {
      id: true,
      entityId: true,
      stream: true,
      severity: true,
      triggerType: true,
    },
  })

  // Aggregate per entity: distinct streams, max severity, fire ids.
  const byEntity = new Map<
    string,
    { streams: Set<string>; maxSeverity: number; fireIds: string[]; triggerTypes: Set<string> }
  >()
  for (const ev of events) {
    const existing = byEntity.get(ev.entityId) ?? {
      streams: new Set<string>(),
      maxSeverity: 0,
      fireIds: [],
      triggerTypes: new Set<string>(),
    }
    // Exclude meta stream from the distinct-streams count per v2 spec
    // (meta is derived, not a source signal).
    if (ev.stream !== 'meta') existing.streams.add(ev.stream)
    existing.maxSeverity = Math.max(existing.maxSeverity, ev.severity)
    existing.fireIds.push(ev.id)
    existing.triggerTypes.add(ev.triggerType)
    byEntity.set(ev.entityId, existing)
  }

  // Featured set lookup for bypass.
  const featuredRows = await prisma.trackedEntity.findMany({
    where: { isFeatured: true, active: true },
    select: { id: true },
  })
  const featuredIds = new Set(featuredRows.map((r) => r.id))

  const redis = getRedisConnection()
  const result: GenerateCandidatesResult = {
    candidatesQualified: 0,
    candidatesEnqueued: 0,
    candidatesRateLimited: 0,
    windowEventsProcessed: events.length,
    durationMs: 0,
  }

  for (const [entityId, info] of byEntity.entries()) {
    const qualifies = entityQualifies(entityId, info, featuredIds)
    if (!qualifies) continue
    result.candidatesQualified++

    // Featured bypasses rate limit.
    const bypassRateLimit = featuredIds.has(entityId)
    if (!bypassRateLimit) {
      const limited = await checkCandidateRateLimit(redis, entityId)
      if (limited) {
        result.candidatesRateLimited++
        continue
      }
    }

    const queue = getQueue<GapScoreCandidateComputeJob>(QUEUE_NAMES.GAP_SCORE_CANDIDATE_COMPUTE)
    await queue.add(
      `candidate:${entityId}:${runId}`,
      {
        entityId,
        triggerEventIds: info.fireIds,
        candidateRunId: runId,
      },
    )
    result.candidatesEnqueued++

    // Mark TriggerEvent rows as contributing to this candidate run.
    await prisma.triggerEvent.updateMany({
      where: { id: { in: info.fireIds } },
      data: { candidateGeneratedAt: now },
    })
  }

  result.durationMs = Date.now() - start
  return result
}

interface EntityAggregateInfo {
  streams: Set<string>
  maxSeverity: number
  fireIds: string[]
  triggerTypes: Set<string>
}

/**
 * Exported so tests can exercise qualification logic in isolation.
 * Qualifies when:
 *   (a) featured + any fire, OR
 *   (b) any fire with severity ≥ HIGH_SEVERITY_THRESHOLD, OR
 *   (c) distinct non-meta streams ≥ DISTINCT_STREAMS_REQUIRED
 */
export function entityQualifies(
  entityId: string,
  info: EntityAggregateInfo,
  featuredIds: Set<string>,
): boolean {
  if (info.fireIds.length === 0) return false
  if (featuredIds.has(entityId)) return true
  if (info.maxSeverity >= HIGH_SEVERITY_THRESHOLD) return true
  if (info.streams.size >= DISTINCT_STREAMS_REQUIRED) return true
  return false
}

async function checkCandidateRateLimit(redis: Redis, entityId: string): Promise<boolean> {
  const key = `${getQueuePrefix()}candidate-limiter:${entityId}`
  // SET with NX + EX: atomic "set-if-absent with TTL". Returns OK on set,
  // null when the key already exists. Any string body works; we store
  // timestamp for debugging.
  const result = await redis.set(key, String(Date.now()), 'EX', RATE_LIMIT_TTL_SECONDS, 'NX')
  // result === 'OK' means we acquired the slot (not rate-limited).
  // result === null means the key existed (rate-limited).
  return result === null
}
