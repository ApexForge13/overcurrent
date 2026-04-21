import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Substitute ioredis with ioredis-mock so no real Redis dialing happens
// during unit tests. Applies to any transitively-imported `from 'ioredis'`.
vi.mock('ioredis', async () => {
  const { default: RedisMock } = await import('ioredis-mock')
  return { Redis: RedisMock, default: RedisMock }
})

describe('queue connection', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.REDIS_URL = 'redis://localhost:6379'
    delete process.env.QUEUE_PREFIX
  })

  afterEach(async () => {
    const { closeRedisConnection } = await import('@/lib/queue/connection')
    await closeRedisConnection()
  })

  it('throws when REDIS_URL is not set', async () => {
    vi.resetModules()
    delete process.env.REDIS_URL
    const { getRedisConnection } = await import('@/lib/queue/connection')
    expect(() => getRedisConnection()).toThrow(/REDIS_URL is not set/)
  })

  it('returns the same instance across repeated calls (singleton)', async () => {
    const { getRedisConnection } = await import('@/lib/queue/connection')
    const a = getRedisConnection()
    const b = getRedisConnection()
    expect(a).toBe(b)
  })

  it('configures maxRetriesPerRequest: null (BullMQ worker requirement)', async () => {
    const { getRedisConnection } = await import('@/lib/queue/connection')
    const conn = getRedisConnection()
    const opts = (conn as unknown as { options: { maxRetriesPerRequest: unknown } }).options
    expect(opts.maxRetriesPerRequest).toBeNull()
  })

  it('closeRedisConnection is idempotent (safe to call multiple times)', async () => {
    const { getRedisConnection, closeRedisConnection } = await import('@/lib/queue/connection')
    getRedisConnection()
    await closeRedisConnection()
    await expect(closeRedisConnection()).resolves.toBeUndefined()
  })

  it('getQueuePrefix defaults to overcurrent:dev: when QUEUE_PREFIX unset', async () => {
    const { getQueuePrefix } = await import('@/lib/queue/connection')
    expect(getQueuePrefix()).toBe('overcurrent:dev:')
  })

  it('getQueuePrefix reflects QUEUE_PREFIX when set', async () => {
    process.env.QUEUE_PREFIX = 'overcurrent:prod:'
    const { getQueuePrefix } = await import('@/lib/queue/connection')
    expect(getQueuePrefix()).toBe('overcurrent:prod:')
  })
})
