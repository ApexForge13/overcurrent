/**
 * Queue health probe.
 *
 * Reports the state of the shared Redis connection and, for each known queue,
 * the current job-count breakdown. Consumed by
 * /api/admin/queue-health/route.ts and the admin dashboard.
 *
 * Any single queue's count query failing is captured per-queue as
 * `error: string` rather than bubbling up — a broken one queue should not
 * mask the state of the others. Redis ping failure short-circuits: if the
 * connection is dead the depth queries will all fail, so we skip them.
 */

import { getQueue } from './queues'
import { getRedisConnection } from './connection'
import { ALL_QUEUE_NAMES, type QueueName } from './names'

export type QueueDepthReport =
  | {
      waiting: number
      active: number
      completed: number
      failed: number
      delayed: number
      paused: number
    }
  | { error: string }

export interface QueueHealthReport {
  redis: 'ok' | 'error'
  redisError?: string
  queues: Record<QueueName, QueueDepthReport>
  checkedAt: string // ISO 8601
}

export async function checkQueueHealth(): Promise<QueueHealthReport> {
  const checkedAt = new Date().toISOString()

  // ── 1. Redis ping ──
  let redisStatus: 'ok' | 'error' = 'ok'
  let redisError: string | undefined
  try {
    const connection = getRedisConnection()
    const pong = await connection.ping()
    if (pong !== 'PONG') {
      redisStatus = 'error'
      redisError = `unexpected ping response: ${pong}`
    }
  } catch (err) {
    redisStatus = 'error'
    redisError = err instanceof Error ? err.message : String(err)
  }

  // ── 2. Per-queue depths ──
  // Short-circuit when Redis is down; every query would fail individually.
  const queues: Record<string, QueueDepthReport> = {}
  if (redisStatus === 'error') {
    for (const name of ALL_QUEUE_NAMES) {
      queues[name] = { error: 'redis unreachable' }
    }
  } else {
    await Promise.all(
      ALL_QUEUE_NAMES.map(async (name) => {
        try {
          const q = getQueue(name)
          const counts = await q.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
          )
          queues[name] = {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            paused: counts.paused ?? 0,
          }
        } catch (err) {
          queues[name] = {
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }),
    )
  }

  return {
    redis: redisStatus,
    ...(redisError ? { redisError } : {}),
    queues: queues as Record<QueueName, QueueDepthReport>,
    checkedAt,
  }
}
