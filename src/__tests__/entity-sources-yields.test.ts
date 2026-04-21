import { describe, expect, it } from 'vitest'
import { YIELD_CATALOG, loadYieldEntities } from '@/lib/entities/sources/yields'

describe('YIELD_CATALOG', () => {
  it('contains 8 sovereign yields (4 US Treasuries + 4 foreign 10Y)', () => {
    expect(YIELD_CATALOG).toHaveLength(8)
  })

  it('includes US Treasury curve points DGS2/5/10/30', () => {
    const ids = YIELD_CATALOG.map((y) => y.identifier)
    expect(ids).toEqual(expect.arrayContaining(['DGS2', 'DGS5', 'DGS10', 'DGS30']))
  })

  it('includes foreign sovereign 10Y (DE/JP/UK/IT)', () => {
    const ids = YIELD_CATALOG.map((y) => y.identifier)
    expect(ids).toEqual(expect.arrayContaining(['DE10Y', 'JP10Y', 'UK10Y', 'IT10Y']))
  })

  it('every yield has a FRED series ID', () => {
    for (const spec of YIELD_CATALOG) {
      expect(spec.fredSeriesId).toBeTruthy()
    }
  })

  it('US Treasuries use DGSx series directly; foreign use IRLTLT01* alt', () => {
    const us = YIELD_CATALOG.find((y) => y.identifier === 'DGS10')
    const de = YIELD_CATALOG.find((y) => y.identifier === 'DE10Y')
    expect(us?.fredSeriesId).toBe('DGS10')
    expect(de?.fredSeriesId).toMatch(/^IRLTLT01/)
  })
})

describe('loadYieldEntities', () => {
  const entities = loadYieldEntities()

  it('every entity has category=yield', () => {
    expect(entities.every((e) => e.category === 'yield')).toBe(true)
  })

  it('providerIds.fredSeriesId is populated for historical loading', () => {
    for (const e of entities) {
      expect(e.providerIds.fredSeriesId).toBeTruthy()
    }
  })

  it('applicable triggers are T-GT5, T-GT6, T-GT9 (rate-sensitive to macro)', () => {
    for (const e of entities) {
      expect(e.groundTruthMap.applicableTriggers).toEqual(
        expect.arrayContaining(['T-GT5', 'T-GT6', 'T-GT9']),
      )
    }
  })
})
