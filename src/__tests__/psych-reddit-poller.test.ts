import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/ingestion/reddit', () => ({
  searchReddit: vi.fn(),
}))

import { pollRedditForQueries } from '@/lib/gap-score/psychological/reddit-poller'
import { searchReddit } from '@/ingestion/reddit'
import { clearAliasIndexCache } from '@/lib/entity-extraction/alias-index'

const redditMock = vi.mocked(searchReddit)

function mockPrisma(entities: Array<{ id: string; identifier: string; aliases?: string[] }>): PrismaClient {
  return {
    trackedEntity: {
      findMany: vi.fn().mockResolvedValue(
        entities.map((e) => ({
          id: e.id,
          identifier: e.identifier,
          category: 'equity',
          entityStrings: { aliases: e.aliases ?? [] },
          active: true,
        })),
      ),
    },
    entityObservation: {
      createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })),
    },
  } as unknown as PrismaClient
}

describe('Reddit psych poller', () => {
  beforeEach(() => {
    redditMock.mockReset()
    clearAliasIndexCache()
  })

  it('fetches + entity-extracts + writes observations with engagement', async () => {
    redditMock.mockResolvedValueOnce([
      {
        url: 'https://reddit.com/r/stocks/x',
        title: '$AAPL to the moon!',
        subreddit: 'stocks',
        score: 500,
        numComments: 80,
        createdUtc: Math.floor(new Date('2026-04-22T10:00:00Z').getTime() / 1000),
      },
    ])
    const prisma = mockPrisma([{ id: 'e-aapl', identifier: 'AAPL' }])
    const result = await pollRedditForQueries(prisma, ['$AAPL'])
    expect(result.postsFetched).toBe(1)
    const createMany = prisma.entityObservation.createMany as ReturnType<typeof vi.fn>
    const data = (createMany.mock.calls[0][0] as { data: Array<{ engagement: number; sourceType: string }> }).data
    expect(data[0].sourceType).toBe('reddit_post')
    expect(data[0].engagement).toBe(580) // 500 + 80
  })

  it('skips posts with no entity match', async () => {
    redditMock.mockResolvedValueOnce([
      {
        url: 'https://reddit.com/r/stocks/y',
        title: 'Random post about nothing',
        subreddit: 'stocks',
        score: 10,
        numComments: 5,
        createdUtc: Math.floor(Date.now() / 1000),
      },
    ])
    const prisma = mockPrisma([{ id: 'e-aapl', identifier: 'AAPL' }])
    const result = await pollRedditForQueries(prisma, ['test'])
    expect(result.unmatchedPosts).toBe(1)
    expect(result.observationsAttempted).toBe(0)
  })

  it('outlet is prefixed with r/', async () => {
    redditMock.mockResolvedValueOnce([
      {
        url: 'https://reddit.com/r/wallstreetbets/z',
        title: '$TSLA diamond hands',
        subreddit: 'wallstreetbets',
        score: 1000,
        numComments: 200,
        createdUtc: Math.floor(Date.now() / 1000),
      },
    ])
    const prisma = mockPrisma([{ id: 'e-tsla', identifier: 'TSLA' }])
    await pollRedditForQueries(prisma, ['$TSLA'])
    const createMany = prisma.entityObservation.createMany as ReturnType<typeof vi.fn>
    const data = (createMany.mock.calls[0][0] as { data: Array<{ outlet: string }> }).data
    expect(data[0].outlet).toBe('r/wallstreetbets')
  })

  it('tolerates searchReddit errors', async () => {
    redditMock.mockRejectedValueOnce(new Error('rate limited'))
    const prisma = mockPrisma([])
    const result = await pollRedditForQueries(prisma, ['test'])
    expect(result.postsFetched).toBe(0)
  })
})
