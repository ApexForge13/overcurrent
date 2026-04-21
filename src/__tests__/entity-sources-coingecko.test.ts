import { describe, expect, it, vi } from 'vitest'
import {
  parseCoinGeckoResponse,
  loadCoinGeckoEntities,
} from '@/lib/entities/sources/coingecko'

describe('parseCoinGeckoResponse', () => {
  it('returns [] for empty array', () => {
    expect(parseCoinGeckoResponse([])).toEqual([])
  })

  it('parses top rows into TrackedEntityInput shape', () => {
    const rows = [
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1_000_000 },
      { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap_rank: 2, market_cap: 500_000 },
    ]
    const result = parseCoinGeckoResponse(rows)
    expect(result).toHaveLength(2)
    expect(result[0].identifier).toBe('BTC')
    expect(result[0].category).toBe('crypto')
    expect(result[0].providerIds.coingeckoId).toBe('bitcoin')
    expect(result[0].providerIds.coingeckoRank).toBe(1)
  })

  it('dedupes symbols — earlier rank wins', () => {
    const rows = [
      { id: 'real-bat', symbol: 'bat', name: 'Basic Attention Token', market_cap_rank: 100, market_cap: 100 },
      { id: 'fake-bat', symbol: 'bat', name: 'Battle Token', market_cap_rank: 5000, market_cap: 1 },
    ]
    const result = parseCoinGeckoResponse(rows)
    expect(result).toHaveLength(1)
    expect(result[0].providerIds.coingeckoId).toBe('real-bat')
  })

  it('populates cashtag + hashtag aliases', () => {
    const rows = [
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1 },
    ]
    const [entity] = parseCoinGeckoResponse(rows)
    expect(entity.entityStrings.aliases).toContain('BTC')
    expect(entity.entityStrings.aliases).toContain('$BTC')
    expect(entity.entityStrings.aliases).toContain('#BTC')
  })

  it('skips rows with missing id / symbol / name', () => {
    const rows = [
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1 },
      { id: '', symbol: 'x', name: 'Bad' },
      { id: 'y', symbol: '', name: 'Bad' },
      { id: 'z', symbol: 'z', name: '' },
    ] as unknown as Parameters<typeof parseCoinGeckoResponse>[0]
    const result = parseCoinGeckoResponse(rows)
    expect(result).toHaveLength(1)
  })
})

describe('loadCoinGeckoEntities', () => {
  it('respects the limit option (single page when limit < perPage)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        Array.from({ length: 250 }, (_, i) => ({
          id: `c${i}`,
          symbol: `c${i}`,
          name: `Coin ${i}`,
          market_cap_rank: i + 1,
          market_cap: 1000 - i,
        })),
    } as Response)
    const result = await loadCoinGeckoEntities({
      fetchImpl,
      limit: 100,
      pageDelaySeconds: 0,
    })
    expect(result.length).toBeLessThanOrEqual(100)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('paginates when limit > perPage', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () =>
        Array.from({ length: 250 }, (_, i) => ({
          id: `c${Math.random()}`,
          symbol: `sym${Math.random()}`,
          name: `N${Math.random()}`,
          market_cap_rank: i,
          market_cap: 1,
        })),
    } as unknown as Response))
    await loadCoinGeckoEntities({ fetchImpl, limit: 500, pageDelaySeconds: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(2) // 2 pages × 250 = 500
  })

  it('throws on 429 after exhausting retries (so orchestrator can surface)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => '0' }, // retry-after=0 so any retries are instant
    } as unknown as Response)
    await expect(
      loadCoinGeckoEntities({ fetchImpl, limit: 1, pageDelaySeconds: 0, maxRetries: 0 }),
    ).rejects.toThrow(/CoinGecko fetch failed/)
  })

  it('retries once on 429 then succeeds on 200 (Phase 1c rate-limit resilience)', async () => {
    let callCount = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: () => '0' },
        } as unknown as Response
      }
      return {
        ok: true,
        json: async () => [
          { id: 'btc', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, market_cap: 1 },
        ],
      } as unknown as Response
    })
    const result = await loadCoinGeckoEntities({
      fetchImpl,
      limit: 1,
      pageDelaySeconds: 0,
      maxRetries: 3,
    })
    expect(result).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
