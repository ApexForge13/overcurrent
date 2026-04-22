import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/ingestion/twitter-discourse', () => ({
  fetchTwitterDiscourse: vi.fn(),
}))

import { pollTwitterForQueries, buildFeaturedSetTwitterQueries } from '@/lib/gap-score/psychological/twitter-poller'
import { fetchTwitterDiscourse } from '@/ingestion/twitter-discourse'
import { clearAliasIndexCache } from '@/lib/entity-extraction/alias-index'

const twitterMock = vi.mocked(fetchTwitterDiscourse)

function mockPrisma(entities: Array<{ id: string; identifier: string; isFeatured?: boolean; aliases?: string[] }> = []): PrismaClient {
  return {
    trackedEntity: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        const list = entities
          .filter((e) => {
            if (where?.isFeatured === true && !e.isFeatured) return false
            return true
          })
          .map((e) => ({
            id: e.id,
            identifier: e.identifier,
            category: 'equity',
            entityStrings: { aliases: e.aliases ?? [] },
            active: true,
            isFeatured: e.isFeatured ?? false,
          }))
        return Promise.resolve(list)
      }),
    },
    entityObservation: {
      createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })),
    },
    costLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('Twitter psych poller', () => {
  beforeEach(() => {
    twitterMock.mockReset()
    clearAliasIndexCache()
    process.env.TWITTER_BEARER_TOKEN = 'mock-token'
  })
  afterEach(() => {
    delete process.env.TWITTER_BEARER_TOKEN
  })

  it('returns keyMissing=true and empty result when TWITTER_BEARER_TOKEN absent', async () => {
    delete process.env.TWITTER_BEARER_TOKEN
    const prisma = mockPrisma([])
    const r = await pollTwitterForQueries(prisma, ['$AAPL'])
    expect(r.keyMissing).toBe(true)
    expect(r.postsFetched).toBe(0)
  })

  it('fetches + extracts + writes with summed engagement', async () => {
    twitterMock.mockResolvedValueOnce([
      {
        platform: 'twitter',
        url: 'https://x.com/user/status/1',
        author: 'trader42',
        authorFollowers: 5000,
        isVerified: false,
        content: '$AAPL breakout confirmed',
        hashtags: ['aapl'],
        likes: 100,
        retweets: 30,
        replies: 20,
        views: 10000,
        createdAt: '2026-04-22T10:00:00Z',
      },
    ])
    const prisma = mockPrisma([{ id: 'e-aapl', identifier: 'AAPL' }])
    const r = await pollTwitterForQueries(prisma, ['$AAPL'])
    expect(r.postsFetched).toBe(1)
    const createMany = prisma.entityObservation.createMany as ReturnType<typeof vi.fn>
    const data = (createMany.mock.calls[0][0] as { data: Array<{ engagement: number; outlet: string }> }).data
    expect(data[0].engagement).toBe(150) // 100 + 30 + 20
    expect(data[0].outlet).toBe('@trader42')
  })

  it('buildFeaturedSetTwitterQueries returns cashtag-prefixed identifiers for featured set', async () => {
    const prisma = mockPrisma([
      { id: 'e-aapl', identifier: 'AAPL', isFeatured: true },
      { id: 'e-tsla', identifier: 'TSLA', isFeatured: true },
      { id: 'e-msft', identifier: 'MSFT', isFeatured: false }, // not featured
    ])
    const queries = await buildFeaturedSetTwitterQueries(prisma)
    expect(queries).toContain('$AAPL')
    expect(queries).toContain('$TSLA')
    expect(queries).not.toContain('$MSFT')
  })

  it('includeAllActive=true expands beyond featured set (1c.2b.2 scale-up hook)', async () => {
    const prisma = mockPrisma([
      { id: 'e-aapl', identifier: 'AAPL', isFeatured: true },
      { id: 'e-msft', identifier: 'MSFT', isFeatured: false },
    ])
    const queries = await buildFeaturedSetTwitterQueries(prisma, { includeAllActive: true })
    expect(queries).toContain('$AAPL')
    expect(queries).toContain('$MSFT')
  })
})
