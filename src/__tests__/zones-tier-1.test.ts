import { describe, expect, it } from 'vitest'
import {
  TIER_1_ZONES,
  ZONE_METRIC_NAMES,
  classifyZoneDirection,
  type MonitoringZone,
} from '@/lib/gap-score/zones/tier-1-zones'

describe('TIER_1_ZONES', () => {
  it('exposes the full Tier 1 catalog (43 zones — 11 crude export + 6 crude import + 5 lng export + 7 container + 4 grain + 3 metals + 7 chokepoint)', () => {
    expect(TIER_1_ZONES).toHaveLength(43)
  })

  it('zone counts by category match the expected Tier 1 composition', () => {
    const byCategory = TIER_1_ZONES.reduce<Record<string, number>>((acc, z) => {
      acc[z.category] = (acc[z.category] ?? 0) + 1
      return acc
    }, {})
    expect(byCategory.crude_export).toBe(10)
    expect(byCategory.refined_products).toBe(1) // fujairah
    expect(byCategory.crude_import).toBe(6)
    expect(byCategory.lng_export).toBe(5)
    expect(byCategory.container).toBe(7)
    expect(byCategory.grain).toBe(4)
    expect(byCategory.metals).toBe(3)
    expect(byCategory.chokepoint).toBe(7)
  })

  it('has no duplicate zone IDs', () => {
    const ids = TIER_1_ZONES.map((z) => z.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('country accepts string | null (three chokepoints are null)', () => {
    const nullCountries = TIER_1_ZONES.filter((z) => z.country === null)
    expect(nullCountries.map((z) => z.id).sort()).toEqual(['bab_el_mandeb', 'hormuz', 'malacca'])
  })

  it('every zone has a valid category', () => {
    const validCategories = new Set([
      'crude_export',
      'crude_import',
      'lng_export',
      'lng_import',
      'container',
      'grain',
      'metals',
      'chokepoint',
      'refined_products',
    ])
    for (const z of TIER_1_ZONES) {
      expect(validCategories.has(z.category), `${z.id}: ${z.category}`).toBe(true)
    }
  })

  it('every zone references at least one commodity', () => {
    for (const z of TIER_1_ZONES) {
      expect(z.relevantCommodities.length).toBeGreaterThan(0)
    }
  })

  it('ZONE_METRIC_NAMES has the four ship-type counts', () => {
    expect(ZONE_METRIC_NAMES).toEqual([
      'tankerCount',
      'containerShipCount',
      'bulkCarrierCount',
      'lngCarrierCount',
    ])
  })
})

describe('classifyZoneDirection', () => {
  const exportZone: MonitoringZone = {
    id: 'test_export',
    name: 'Test Export',
    country: 'US',
    region: 'test',
    category: 'crude_export',
    boundingBox: { minLat: 0, maxLat: 1, minLong: 0, maxLong: 1 },
    relevantCommodities: ['CL=F'],
    shipTypeFilter: ['tanker'],
  }
  const importZone: MonitoringZone = { ...exportZone, id: 'test_import', category: 'crude_import' }
  const chokepoint: MonitoringZone = { ...exportZone, id: 'test_chokepoint', category: 'chokepoint' }

  it('export + buildup is bearish (oversupply)', () => {
    const result = classifyZoneDirection(exportZone, 'tankerCount', 'above_baseline')
    expect(result.direction).toBe(-1)
    expect(result.notes).toMatch(/oversupply/)
  })

  it('export + drawdown is bullish (tight supply)', () => {
    const result = classifyZoneDirection(exportZone, 'tankerCount', 'below_baseline')
    expect(result.direction).toBe(1)
    expect(result.notes).toMatch(/tight supply/)
  })

  it('import + buildup is bullish (demand arriving)', () => {
    const result = classifyZoneDirection(importZone, 'tankerCount', 'above_baseline')
    expect(result.direction).toBe(1)
  })

  it('import + drawdown is bearish (demand softening)', () => {
    const result = classifyZoneDirection(importZone, 'tankerCount', 'below_baseline')
    expect(result.direction).toBe(-1)
  })

  it('chokepoint anomaly in either direction is ambiguous (direction=0)', () => {
    const above = classifyZoneDirection(chokepoint, 'tankerCount', 'above_baseline')
    const below = classifyZoneDirection(chokepoint, 'tankerCount', 'below_baseline')
    expect(above.direction).toBe(0)
    expect(below.direction).toBe(0)
    expect(above.notes).toMatch(/chokepoint anomaly/)
  })
})
