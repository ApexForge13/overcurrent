import { describe, expect, it } from 'vitest'
import {
  MACRO_DIRECTION_MAPS,
  getDirectionMap,
} from '@/lib/historical-data/direction-maps'
import { FRED_INDICATORS } from '@/lib/historical-data/fred-client'
import { EIA_INDICATORS } from '@/lib/historical-data/eia-client'
import { USDA_INDICATORS } from '@/lib/historical-data/usda-client'

describe('macro direction maps', () => {
  it('covers every FRED indicator', () => {
    for (const spec of FRED_INDICATORS) {
      expect(MACRO_DIRECTION_MAPS[spec.seriesId]).toBeDefined()
    }
  })

  it('covers every EIA indicator', () => {
    for (const spec of EIA_INDICATORS) {
      expect(MACRO_DIRECTION_MAPS[spec.seriesId]).toBeDefined()
    }
  })

  it('covers every USDA indicator', () => {
    for (const spec of USDA_INDICATORS) {
      expect(MACRO_DIRECTION_MAPS[spec.seriesId]).toBeDefined()
    }
  })

  it('every mapping entry has positive + negative keys', () => {
    for (const [indicator, assetMap] of Object.entries(MACRO_DIRECTION_MAPS)) {
      for (const [asset, dir] of Object.entries(assetMap)) {
        expect(dir.positive, `${indicator}/${asset}.positive`).toBeTypeOf('number')
        expect(dir.negative, `${indicator}/${asset}.negative`).toBeTypeOf('number')
      }
    }
  })

  it('direction magnitudes stay within [-1, 1]', () => {
    for (const [indicator, assetMap] of Object.entries(MACRO_DIRECTION_MAPS)) {
      for (const [asset, dir] of Object.entries(assetMap)) {
        expect(Math.abs(dir.positive), `${indicator}/${asset}.positive`).toBeLessThanOrEqual(1)
        expect(Math.abs(dir.negative), `${indicator}/${asset}.negative`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('positive and negative directions have opposite signs (no stuck mapping)', () => {
    // If positive and negative have the same sign, the mapping doesn't differentiate
    // surprise direction and is almost certainly a bug.
    for (const [indicator, assetMap] of Object.entries(MACRO_DIRECTION_MAPS)) {
      for (const [asset, dir] of Object.entries(assetMap)) {
        if (dir.positive === 0 && dir.negative === 0) continue // explicitly neutral
        const product = dir.positive * dir.negative
        expect(product, `${indicator}/${asset} positive*negative should be negative`).toBeLessThan(0)
      }
    }
  })

  it('CPI treats hot surprise as bearish equities and bullish gold (inflation hedge)', () => {
    const cpi = MACRO_DIRECTION_MAPS.CPIAUCSL
    expect(cpi.SPY.positive).toBeLessThan(0)
    expect(cpi['GC=F'].positive).toBeGreaterThan(0)
  })

  it('Unemployment is inverted: higher-than-expected is bearish equities', () => {
    const unrate = MACRO_DIRECTION_MAPS.UNRATE
    expect(unrate.SPY.positive).toBeLessThan(0)
    expect(unrate.TLT.positive).toBeGreaterThan(0) // bonds rally on weak labor
  })

  it('EIA crude build surprise is bearish crude (oversupply signal)', () => {
    const eia = MACRO_DIRECTION_MAPS.EIA_CRUDE
    expect(eia['CL=F'].positive).toBeLessThan(0)
    expect(eia['BZ=F'].positive).toBeLessThan(0)
  })

  it('getDirectionMap returns null for unknown indicator', () => {
    expect(getDirectionMap('NOT_A_REAL_INDICATOR')).toBeNull()
  })
})
