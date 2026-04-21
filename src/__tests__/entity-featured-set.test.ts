import { describe, expect, it } from 'vitest'
import {
  FEATURED_SET_IDENTIFIERS,
  FEATURED_SET_BREAKDOWN,
  isFeatured,
} from '@/lib/entities/featured-set'

describe('featured set', () => {
  it('contains exactly 15 entities', () => {
    expect(FEATURED_SET_IDENTIFIERS).toHaveLength(15)
    expect(FEATURED_SET_BREAKDOWN.total).toBe(15)
  })

  it('breakdown is 6 commodity + 7 equity + 2 crypto', () => {
    expect(FEATURED_SET_BREAKDOWN.commodity).toBe(6)
    expect(FEATURED_SET_BREAKDOWN.equity).toBe(7)
    expect(FEATURED_SET_BREAKDOWN.crypto).toBe(2)
    expect(
      FEATURED_SET_BREAKDOWN.commodity + FEATURED_SET_BREAKDOWN.equity + FEATURED_SET_BREAKDOWN.crypto,
    ).toBe(FEATURED_SET_BREAKDOWN.total)
  })

  it('has no duplicate identifiers', () => {
    const seen = new Set(FEATURED_SET_IDENTIFIERS)
    expect(seen.size).toBe(FEATURED_SET_IDENTIFIERS.length)
  })

  it('includes all six core commodities as =F futures', () => {
    for (const id of ['CL=F', 'BZ=F', 'NG=F', 'GC=F', 'HG=F', 'ZS=F']) {
      expect(FEATURED_SET_IDENTIFIERS).toContain(id)
    }
  })

  it('includes AAPL, NVDA, TSLA, XOM, JPM, SPY, QQQ', () => {
    for (const id of ['AAPL', 'NVDA', 'TSLA', 'XOM', 'JPM', 'SPY', 'QQQ']) {
      expect(FEATURED_SET_IDENTIFIERS).toContain(id)
    }
  })

  it('includes BTC and ETH', () => {
    expect(FEATURED_SET_IDENTIFIERS).toContain('BTC')
    expect(FEATURED_SET_IDENTIFIERS).toContain('ETH')
  })

  it('isFeatured returns true for featured entities', () => {
    expect(isFeatured('AAPL')).toBe(true)
    expect(isFeatured('BTC')).toBe(true)
    expect(isFeatured('CL=F')).toBe(true)
  })

  it('isFeatured returns false for non-featured entities', () => {
    expect(isFeatured('GOOGL')).toBe(false)
    expect(isFeatured('DOGE')).toBe(false)
    expect(isFeatured('')).toBe(false)
  })
})
