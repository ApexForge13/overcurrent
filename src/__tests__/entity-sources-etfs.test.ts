import { describe, expect, it } from 'vitest'
import { ETF_CATALOG, loadEtfEntities } from '@/lib/entities/sources/etfs'

describe('ETF_CATALOG', () => {
  it('has no duplicate tickers', () => {
    const tickers = ETF_CATALOG.map((e) => e.ticker)
    expect(new Set(tickers).size).toBe(tickers.length)
  })

  it('covers the expected subcategories', () => {
    const subs = new Set(ETF_CATALOG.map((e) => e.subcategory))
    expect(subs).toEqual(
      new Set([
        'broad_market',
        'bonds',
        'commodity_etf',
        'sector',
        'international',
        'thematic',
        'volatility',
      ]),
    )
  })

  it('includes core featured-set ETFs (SPY, QQQ)', () => {
    const tickers = ETF_CATALOG.map((e) => e.ticker)
    expect(tickers).toContain('SPY')
    expect(tickers).toContain('QQQ')
  })

  it('includes commodity proxies referenced by direction maps (USO, UNG, GLD)', () => {
    const tickers = ETF_CATALOG.map((e) => e.ticker)
    expect(tickers).toContain('USO')
    expect(tickers).toContain('UNG')
    expect(tickers).toContain('GLD')
  })
})

describe('loadEtfEntities', () => {
  const entities = loadEtfEntities()

  it('every entity has category="etf"', () => {
    expect(entities.every((e) => e.category === 'etf')).toBe(true)
  })

  it('aliases include $TICKER cashtag', () => {
    const spy = entities.find((e) => e.identifier === 'SPY')
    expect(spy!.entityStrings.aliases).toContain('$SPY')
  })
})
