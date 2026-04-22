import { describe, expect, it } from 'vitest'
import { FUTURES_CATALOG, loadFuturesEntities } from '@/lib/entities/sources/futures'

describe('FUTURES_CATALOG', () => {
  it('includes energy, metals, grains, softs, livestock, equity_index, treasury, fx, crypto', () => {
    const subs = new Set(FUTURES_CATALOG.map((f) => f.subcategory))
    expect(subs).toEqual(
      new Set([
        'energy',
        'metals',
        'grains',
        'softs',
        'livestock',
        'equity_index',
        'treasury',
        'fx',
        'crypto',
      ]),
    )
  })

  it('has no duplicate root symbols', () => {
    const symbols = FUTURES_CATALOG.map((f) => f.symbol)
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it('includes CME crypto futures (MBT, MET) per Phase 1b refinement', () => {
    const symbols = FUTURES_CATALOG.map((f) => f.symbol)
    expect(symbols).toContain('MBT')
    expect(symbols).toContain('MET')
  })

  it('includes the six featured-set commodities (CL, BZ, NG, GC, HG, ZS)', () => {
    const symbols = FUTURES_CATALOG.map((f) => f.symbol)
    for (const s of ['CL', 'BZ', 'NG', 'GC', 'HG', 'ZS']) {
      expect(symbols).toContain(s)
    }
  })
})

describe('loadFuturesEntities', () => {
  const entities = loadFuturesEntities()

  it('produces =F-suffixed identifiers for every future', () => {
    for (const e of entities) {
      expect(e.identifier.endsWith('=F')).toBe(true)
    }
  })

  it('each entity has ground-truth triggers populated', () => {
    for (const e of entities) {
      expect(e.groundTruthMap.applicableTriggers.length).toBeGreaterThan(0)
    }
  })

  it('aliases contain the root symbol + =F identifier + product name', () => {
    const cl = entities.find((e) => e.identifier === 'CL=F')
    expect(cl).toBeDefined()
    expect(cl!.entityStrings.aliases).toContain('CL')
    expect(cl!.entityStrings.aliases).toContain('CL=F')
    expect(cl!.entityStrings.aliases).toContain('WTI Crude Oil')
  })

  it('commodity futures get T-GT8 (inventory release) in triggers', () => {
    const cl = entities.find((e) => e.identifier === 'CL=F')
    expect(cl!.groundTruthMap.applicableTriggers).toContain('T-GT8')
  })

  it('crypto futures do NOT get T-GT8 (no inventory releases for crypto)', () => {
    const mbt = entities.find((e) => e.identifier === 'MBT=F')
    expect(mbt!.groundTruthMap.applicableTriggers).not.toContain('T-GT8')
  })

  it('Treasury futures (ZB/ZN/ZT/ZF) are category=yield post-1c.2a recategorization', () => {
    for (const sym of ['ZB', 'ZN', 'ZT', 'ZF']) {
      const e = entities.find((x) => x.identifier === `${sym}=F`)
      expect(e).toBeDefined()
      expect(e!.category).toBe('yield')
      expect(e!.subcategory).toBe('treasury')
    }
  })

  it('Treasury futures still get the rate-sensitive trigger set (T-GT5/6/9)', () => {
    const zn = entities.find((e) => e.identifier === 'ZN=F')
    expect(zn!.groundTruthMap.applicableTriggers).toEqual(expect.arrayContaining(['T-GT5', 'T-GT6', 'T-GT9']))
  })

  it('FX futures (6E, 6J, 6B, 6A, 6C, 6S) remain category=fx', () => {
    for (const sym of ['6E', '6J', '6B', '6A', '6C', '6S']) {
      const e = entities.find((x) => x.identifier === `${sym}=F`)
      expect(e!.category).toBe('fx')
    }
  })
})
