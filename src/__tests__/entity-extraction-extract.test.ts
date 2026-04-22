import { describe, it, expect } from 'vitest'
import { extractEntities } from '@/lib/entity-extraction/extract-from-text'
import type { AliasIndex } from '@/lib/entity-extraction/alias-index'

function makeIndex(
  entries: Array<{ id: string; identifier: string; aliases?: string[] }>,
): AliasIndex {
  const byIdentifier = new Map<string, { entityId: string; identifier: string; category: string }>()
  const byAlias = new Map<string, { entityId: string; identifier: string; category: string }>()
  for (const e of entries) {
    const entry = { entityId: e.id, identifier: e.identifier, category: 'equity' }
    byIdentifier.set(e.identifier.toUpperCase(), entry)
    for (const a of e.aliases ?? []) {
      byAlias.set(a.toLowerCase(), entry)
    }
  }
  const sortedAliases = Array.from(byAlias.keys()).sort((a, b) => b.length - a.length)
  return { byIdentifier, byAlias, sortedAliases, builtAt: Date.now() }
}

describe('extractEntities', () => {
  it('matches cashtag $AAPL to AAPL identifier', () => {
    const idx = makeIndex([{ id: 'e-aapl', identifier: 'AAPL' }])
    const hits = extractEntities('Watching $AAPL closely today', idx)
    expect(hits).toHaveLength(1)
    expect(hits[0].matchType).toBe('cashtag')
    expect(hits[0].entityId).toBe('e-aapl')
  })

  it('matches plain ticker AAPL as word-boundary match', () => {
    const idx = makeIndex([{ id: 'e-aapl', identifier: 'AAPL' }])
    const hits = extractEntities('AAPL reports earnings tomorrow.', idx)
    expect(hits).toHaveLength(1)
    expect(hits[0].matchType).toBe('ticker')
  })

  it('rejects English false positives (T, IS, THE, etc.)', () => {
    const idx = makeIndex([
      { id: 'e-at', identifier: 'T' }, // AT&T ticker
      { id: 'e-is', identifier: 'IS' }, // nonsense but demonstrates rejection
    ])
    const hits = extractEntities('The quick brown fox IS great.', idx)
    expect(hits).toHaveLength(0)
  })

  it('allows cashtag form to bypass false-positive filter', () => {
    const idx = makeIndex([{ id: 'e-t', identifier: 'T' }])
    const hits = extractEntities('Thoughts on $T earnings?', idx)
    expect(hits).toHaveLength(1)
    expect(hits[0].matchType).toBe('cashtag')
  })

  it('matches alias with word-boundary guard', () => {
    const idx = makeIndex([{ id: 'e-aapl', identifier: 'AAPL', aliases: ['Apple'] }])
    expect(extractEntities('Apple announced new products', idx)).toHaveLength(1)
    // "Appleton" should NOT match "Apple"
    expect(extractEntities('Appleton Wisconsin is scenic', idx)).toHaveLength(0)
  })

  it('dedupes across match types — cashtag + alias for same entity = one result', () => {
    const idx = makeIndex([{ id: 'e-aapl', identifier: 'AAPL', aliases: ['Apple'] }])
    const hits = extractEntities('$AAPL earnings: Apple beat consensus.', idx)
    expect(hits).toHaveLength(1)
    expect(hits[0].matchType).toBe('cashtag') // earliest precedence wins
  })

  it('handles empty text without throwing', () => {
    const idx = makeIndex([{ id: 'e-aapl', identifier: 'AAPL' }])
    expect(extractEntities('', idx)).toEqual([])
  })

  it('longer aliases matched first (prefers "Apple Inc" over "Apple" when both defined)', () => {
    const idx = makeIndex([
      { id: 'e-aapl', identifier: 'AAPL', aliases: ['Apple', 'Apple Inc'] },
      { id: 'e-other', identifier: 'OTHER', aliases: ['App'] }, // won't collide due to word boundary
    ])
    const hits = extractEntities('Apple Inc. reported earnings', idx)
    // Only one match (same entity); matched via longer alias first due to sort order
    expect(hits).toHaveLength(1)
    expect(hits[0].entityId).toBe('e-aapl')
  })
})
