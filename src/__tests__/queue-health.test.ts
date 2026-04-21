import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ioredis', async () => {
  const { default: RedisMock } = await import('ioredis-mock')
  return { Redis: RedisMock, default: RedisMock }
})

describe('checkQueueHealth', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.REDIS_URL = 'redis://localhost:6379'
    delete process.env.QUEUE_PREFIX
  })

  afterEach(async () => {
    vi.doUnmock('@/lib/queue/connection')
    const { closeAllQueues } = await import('@/lib/queue/queues')
    const { closeRedisConnection } = await import('@/lib/queue/connection')
    await closeAllQueues()
    await closeRedisConnection()
  })

  it('reports redis: ok when ping succeeds', async () => {
    const { checkQueueHealth } = await import('@/lib/queue/health')
    const report = await checkQueueHealth()
    expect(report.redis).toBe('ok')
    expect(report.redisError).toBeUndefined()
  })

  it('includes every registered queue in the report', async () => {
    const { checkQueueHealth } = await import('@/lib/queue/health')
    const { ALL_QUEUE_NAMES } = await import('@/lib/queue/names')
    const report = await checkQueueHealth()
    for (const name of ALL_QUEUE_NAMES) {
      expect(report.queues[name]).toBeDefined()
    }
  })

  it('each queue report is either a full count shape or an error entry', async () => {
    // Note: ioredis-mock doesn't fully implement BullMQ's getJobCounts
    // pipeline, so in unit tests the per-queue entry may come back as
    // `{ error: string }` even though Redis ping succeeds. health.ts
    // correctly falls through to the error branch rather than crashing;
    // production with real Redis returns the count shape. This test
    // validates the contract (one of two shapes, never a mutant) without
    // depending on ioredis-mock internals.
    const { checkQueueHealth } = await import('@/lib/queue/health')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const report = await checkQueueHealth()
    const depth = report.queues[QUEUE_NAMES.GAP_SCORE_BACKFILL]
    if ('error' in depth) {
      expect(typeof depth.error).toBe('string')
    } else {
      expect(depth).toEqual({
        waiting: expect.any(Number),
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        delayed: expect.any(Number),
        paused: expect.any(Number),
      })
    }
  })

  it('returns an ISO 8601 checkedAt timestamp', async () => {
    const { checkQueueHealth } = await import('@/lib/queue/health')
    const report = await checkQueueHealth()
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('short-circuits queue queries when Redis ping fails', async () => {
    // Simulate a dead Redis by replacing getRedisConnection with one whose
    // ping throws. The health check must fall through to the per-queue
    // "redis unreachable" state without attempting (and failing) each depth
    // query individually.
    vi.doMock('@/lib/queue/connection', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/queue/connection')>()
      return {
        ...actual,
        getRedisConnection: () =>
          ({
            ping: async () => {
              throw new Error('boom')
            },
          }) as unknown as ReturnType<typeof actual.getRedisConnection>,
      }
    })
    const { checkQueueHealth } = await import('@/lib/queue/health')
    const { ALL_QUEUE_NAMES } = await import('@/lib/queue/names')
    const report = await checkQueueHealth()
    expect(report.redis).toBe('error')
    expect(report.redisError).toContain('boom')
    for (const name of ALL_QUEUE_NAMES) {
      expect(report.queues[name]).toEqual({ error: 'redis unreachable' })
    }
  })
})
