import { describe, expect, it } from 'vitest'
import { FOREX_CATALOG, loadForexEntities } from '@/lib/entities/sources/forex'

describe('FOREX_CATALOG', () => {
  it('contains 20 pairs (7 G10 + 4 crosses + 7 EM + 2 metal spots)', () => {
    expect(FOREX_CATALOG).toHaveLength(20)
  })

  it('includes USD/SGD as the Phase 1c.2a 20th pair', () => {
    const sgd = FOREX_CATALOG.find((f) => f.pair === 'USD/SGD')
    expect(sgd).toBeDefined()
    expect(sgd?.subcategory).toBe('emerging')
  })

  it('has no duplicate pairs', () => {
    const pairs = FOREX_CATALOG.map((f) => f.pair)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('every pair follows slash-form (e.g., EUR/USD)', () => {
    for (const spec of FOREX_CATALOG) {
      expect(spec.pair).toMatch(/^[A-Z]{3}\/[A-Z]{3}$/)
    }
  })

  it('covers the expected subcategories', () => {
    const subs = new Set(FOREX_CATALOG.map((f) => f.subcategory))
    expect(subs).toEqual(new Set(['g10_major', 'cross', 'emerging', 'metal_spot']))
  })

  it('includes XAU/USD + XAG/USD as metal_spot subcategory', () => {
    const metals = FOREX_CATALOG.filter((f) => f.subcategory === 'metal_spot').map((f) => f.pair)
    expect(metals).toEqual(expect.arrayContaining(['XAU/USD', 'XAG/USD']))
  })
})

describe('loadForexEntities', () => {
  const entities = loadForexEntities()

  it('every entity has category=fx', () => {
    expect(entities.every((e) => e.category === 'fx')).toBe(true)
  })

  it('identifier is the slash-form pair', () => {
    const eurUsd = entities.find((e) => e.identifier === 'EUR/USD')
    expect(eurUsd).toBeDefined()
  })

  it('providerIds.fxSymbol is the no-slash form', () => {
    const eurUsd = entities.find((e) => e.identifier === 'EUR/USD')
    expect(eurUsd?.providerIds.fxSymbol).toBe('EURUSD')
  })

  it('aliases include both slash and no-slash forms', () => {
    const eurUsd = entities.find((e) => e.identifier === 'EUR/USD')
    expect(eurUsd?.entityStrings.aliases).toEqual(
      expect.arrayContaining(['EUR/USD', 'EURUSD']),
    )
  })

  it('applicable triggers are T-GT5, T-GT6, T-GT9 (no SEC/Congress/COT)', () => {
    for (const e of entities) {
      expect(e.groundTruthMap.applicableTriggers).toEqual(
        expect.arrayContaining(['T-GT5', 'T-GT6', 'T-GT9']),
      )
      expect(e.groundTruthMap.applicableTriggers).not.toContain('T-GT1')
      expect(e.groundTruthMap.applicableTriggers).not.toContain('T-GT4')
    }
  })
})
