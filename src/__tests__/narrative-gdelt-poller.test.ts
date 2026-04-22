import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/ingestion/gdelt', () => ({
  searchGdeltGlobal: vi.fn(),
}))

import { pollGdeltForQueries, parseSeenDate } from '@/lib/gap-score/narrative/gdelt-poller'
import { searchGdeltGlobal } from '@/ingestion/gdelt'
import { clearAliasIndexCache } from '@/lib/entity-extraction/alias-index'

const gdeltMock = vi.mocked(searchGdeltGlobal)

function mockPrisma(opts: {
  entities?: Array<{ id: string; identifier: string; aliases?: string[] }>
  createManyResult?: { count: number }
} = {}): PrismaClient {
  return {
    trackedEntity: {
      findMany: vi.fn().mockResolvedValue(
        (opts.entities ?? []).map((e) => ({
          id: e.id,
          identifier: e.identifier,
          category: 'equity',
          entityStrings: { aliases: e.aliases ?? [] },
          active: true,
        })),
      ),
    },
    entityObservation: {
      createMany: vi.fn().mockResolvedValue(opts.createManyResult ?? { count: 0 }),
    },
  } as unknown as PrismaClient
}

describe('GDELT narrative poller', () => {
  beforeEach(() => {
    gdeltMock.mockReset()
    clearAliasIndexCache()
  })

  it('parses GDELT seendate into Date', () => {
    expect(parseSeenDate('20260420T091500Z').toISOString()).toBe('2026-04-20T09:15:00.000Z')
    expect(parseSeenDate('')).toBeInstanceOf(Date) // graceful fallback
  })

  it('fetches articles, extracts entities, writes observations', async () => {
    gdeltMock.mockResolvedValueOnce([
      {
        url: 'https://example.test/a1',
        title: '$AAPL surges on earnings beat',
        seendate: '20260420T091500Z',
        domain: 'example.test',
        language: 'English',
        sourcecountry: 'US',
      },
    ])
    const prisma = mockPrisma({
      entities: [{ id: 'e-aapl', identifier: 'AAPL', aliases: ['Apple'] }],
      createManyResult: { count: 1 },
    })
    const result = await pollGdeltForQueries(prisma, ['Apple'])
    expect(result.articlesFetched).toBe(1)
    expect(result.observationsInserted).toBe(1)
    const createMany = prisma.entityObservation.createMany as ReturnType<typeof vi.fn>
    const data = (createMany.mock.calls[0][0] as { data: Array<{ entityId: string; sourceType: string }> }).data
    expect(data[0].entityId).toBe('e-aapl')
    expect(data[0].sourceType).toBe('gdelt_article')
  })

  it('skips articles with no entity match (unmatchedArticles increments)', async () => {
    gdeltMock.mockResolvedValueOnce([
      {
        url: 'https://example.test/a1',
        title: 'Random unrelated news about the weather',
        seendate: '20260420T091500Z',
        domain: 'example.test',
        language: 'English',
        sourcecountry: 'US',
      },
    ])
    const prisma = mockPrisma({ entities: [{ id: 'e-aapl', identifier: 'AAPL' }] })
    const result = await pollGdeltForQueries(prisma, ['Apple'])
    expect(result.articlesFetched).toBe(1)
    expect(result.unmatchedArticles).toBe(1)
    expect(result.observationsAttempted).toBe(0)
  })

  it('tolerates GDELT errors without throwing — returns 0 articles for that query', async () => {
    gdeltMock.mockRejectedValueOnce(new Error('network'))
    const prisma = mockPrisma()
    const result = await pollGdeltForQueries(prisma, ['bogus'])
    expect(result.articlesFetched).toBe(0)
  })

  it('multi-entity article creates one observation per matched entity', async () => {
    gdeltMock.mockResolvedValueOnce([
      {
        url: 'https://example.test/a1',
        title: 'AAPL rallies while TSLA dips on the open',
        seendate: '20260420T091500Z',
        domain: 'example.test',
        language: 'English',
        sourcecountry: 'US',
      },
    ])
    const prisma = mockPrisma({
      entities: [
        { id: 'e-aapl', identifier: 'AAPL' },
        { id: 'e-tsla', identifier: 'TSLA' },
      ],
      createManyResult: { count: 2 },
    })
    await pollGdeltForQueries(prisma, ['market open'])
    const createMany = prisma.entityObservation.createMany as ReturnType<typeof vi.fn>
    const data = (createMany.mock.calls[0][0] as { data: unknown[] }).data
    expect(data).toHaveLength(2)
  })
})
