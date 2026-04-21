import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ioredis', async () => {
  const { default: RedisMock } = await import('ioredis-mock')
  return { Redis: RedisMock, default: RedisMock }
})

describe('queue + worker factories', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.REDIS_URL = 'redis://localhost:6379'
    delete process.env.QUEUE_PREFIX
  })

  afterEach(async () => {
    const { closeAllQueues } = await import('@/lib/queue/queues')
    const { closeRedisConnection } = await import('@/lib/queue/connection')
    await closeAllQueues()
    await closeRedisConnection()
  })

  it('getQueue returns a singleton for the same name', async () => {
    const { getQueue } = await import('@/lib/queue/queues')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const a = getQueue(QUEUE_NAMES.GAP_SCORE_CANDIDATE_COMPUTE)
    const b = getQueue(QUEUE_NAMES.GAP_SCORE_CANDIDATE_COMPUTE)
    expect(a).toBe(b)
  })

  it('getQueue returns distinct instances for different names', async () => {
    const { getQueue } = await import('@/lib/queue/queues')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const a = getQueue(QUEUE_NAMES.GAP_SCORE_CANDIDATE_COMPUTE)
    const b = getQueue(QUEUE_NAMES.GAP_SCORE_BACKFILL)
    expect(a).not.toBe(b)
  })

  it('getQueue applies DEFAULT_JOB_OPTIONS', async () => {
    const { getQueue } = await import('@/lib/queue/queues')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const q = getQueue(QUEUE_NAMES.GAP_SCORE_BACKFILL)
    expect(q.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    })
  })

  it('Queue factory applies default prefix "overcurrent:dev:" when QUEUE_PREFIX unset', async () => {
    const { getQueue } = await import('@/lib/queue/queues')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const q = getQueue(QUEUE_NAMES.PAPER_TRADING_EXECUTE)
    expect(q.opts.prefix).toBe('overcurrent:dev:')
  })

  it('Queue factory applies QUEUE_PREFIX env override', async () => {
    process.env.QUEUE_PREFIX = 'overcurrent:prod:'
    const { getQueue } = await import('@/lib/queue/queues')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const q = getQueue(QUEUE_NAMES.PAPER_TRADING_EXECUTE)
    expect(q.opts.prefix).toBe('overcurrent:prod:')
  })

  it('Worker factory applies default prefix "overcurrent:dev:"', async () => {
    const { createWorker } = await import('@/lib/queue/workers')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const worker = createWorker(
      QUEUE_NAMES.GAP_SCORE_BACKFILL,
      async () => ({ placeholder: true, processedAt: new Date().toISOString() }),
      { concurrency: 1, autorun: false },
    )
    expect(worker.opts.prefix).toBe('overcurrent:dev:')
    await worker.close()
  })

  it('Worker factory applies QUEUE_PREFIX env override', async () => {
    process.env.QUEUE_PREFIX = 'overcurrent:preview:'
    const { createWorker } = await import('@/lib/queue/workers')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const worker = createWorker(
      QUEUE_NAMES.GAP_SCORE_BACKFILL,
      async () => ({ placeholder: true, processedAt: new Date().toISOString() }),
      { concurrency: 1, autorun: false },
    )
    expect(worker.opts.prefix).toBe('overcurrent:preview:')
    await worker.close()
  })

  // ── The non-negotiable isolation test (per user's Phase 1a refinement) ──
  // If the Queue and Worker factories ever apply different prefixes, jobs
  // enqueued by producers won't be consumed by consumers in the same env —
  // or worse, preview workers consume prod jobs. This test locks down the
  // invariant so any future change that forgets to pass prefix through one
  // side is caught immediately.
  it('Queue and Worker factories apply the SAME prefix (env isolation invariant)', async () => {
    process.env.QUEUE_PREFIX = 'overcurrent:isolation-check:'
    const { getQueue } = await import('@/lib/queue/queues')
    const { createWorker } = await import('@/lib/queue/workers')
    const { QUEUE_NAMES } = await import('@/lib/queue/names')
    const q = getQueue(QUEUE_NAMES.GAP_SCORE_BACKFILL)
    const w = createWorker(
      QUEUE_NAMES.GAP_SCORE_BACKFILL,
      async () => ({ placeholder: true, processedAt: new Date().toISOString() }),
      { concurrency: 1, autorun: false },
    )
    expect(q.opts.prefix).toBe('overcurrent:isolation-check:')
    expect(w.opts.prefix).toBe('overcurrent:isolation-check:')
    expect(q.opts.prefix).toBe(w.opts.prefix)
    await w.close()
  })

  it('closeAllQueues is idempotent (safe on empty registry)', async () => {
    const { closeAllQueues } = await import('@/lib/queue/queues')
    await closeAllQueues()
    await expect(closeAllQueues()).resolves.toBeUndefined()
  })
})
