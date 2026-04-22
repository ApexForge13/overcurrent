import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  buildAliasIndex,
  getAliasIndex,
  clearAliasIndexCache,
} from '@/lib/entity-extraction/alias-index'

function mockPrisma(entities: Array<{ id: string; identifier: string; category: string; aliases: string[] }>): PrismaClient {
  return {
    trackedEntity: {
      findMany: vi.fn().mockResolvedValue(
        entities.map((e) => ({
          id: e.id,
          identifier: e.identifier,
          category: e.category,
          entityStrings: { aliases: e.aliases },
          active: true,
        })),
      ),
    },
  } as unknown as PrismaClient
}

describe('alias-index', () => {
  beforeEach(() => {
    clearAliasIndexCache()
  })

  it('buildAliasIndex maps identifiers and aliases', async () => {
    const prisma = mockPrisma([
      { id: 'e-aapl', identifier: 'AAPL', category: 'equity', aliases: ['Apple', 'Apple Inc'] },
      { id: 'e-tsla', identifier: 'TSLA', category: 'equity', aliases: ['Tesla', 'Tesla Inc'] },
    ])
    const index = await buildAliasIndex(prisma)
    expect(index.byIdentifier.get('AAPL')?.entityId).toBe('e-aapl')
    expect(index.byIdentifier.get('TSLA')?.entityId).toBe('e-tsla')
    expect(index.byAlias.get('apple inc')?.entityId).toBe('e-aapl')
    expect(index.byAlias.get('tesla')?.entityId).toBe('e-tsla')
  })

  it('sortedAliases orders by length descending (so longer matches win first)', async () => {
    const prisma = mockPrisma([
      { id: 'e1', identifier: 'X', category: 'equity', aliases: ['AB', 'ABCDE', 'ABCD', 'ABC'] },
    ])
    const index = await buildAliasIndex(prisma)
    expect(index.sortedAliases).toEqual(['abcde', 'abcd', 'abc', 'ab'])
  })

  it('getAliasIndex caches across calls within TTL', async () => {
    const prisma = mockPrisma([
      { id: 'e-aapl', identifier: 'AAPL', category: 'equity', aliases: ['Apple'] },
    ])
    const findMany = prisma.trackedEntity.findMany as ReturnType<typeof vi.fn>
    await getAliasIndex(prisma)
    await getAliasIndex(prisma)
    await getAliasIndex(prisma)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('clearAliasIndexCache forces rebuild on next getAliasIndex', async () => {
    const prisma = mockPrisma([
      { id: 'e-aapl', identifier: 'AAPL', category: 'equity', aliases: ['Apple'] },
    ])
    const findMany = prisma.trackedEntity.findMany as ReturnType<typeof vi.fn>
    await getAliasIndex(prisma)
    clearAliasIndexCache()
    await getAliasIndex(prisma)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('drops degenerate aliases shorter than 2 chars', async () => {
    const prisma = mockPrisma([
      { id: 'e1', identifier: 'X', category: 'equity', aliases: ['A', 'I', 'valid'] },
    ])
    const index = await buildAliasIndex(prisma)
    expect(index.byAlias.has('a')).toBe(false)
    expect(index.byAlias.has('i')).toBe(false)
    expect(index.byAlias.has('valid')).toBe(true)
  })
})
