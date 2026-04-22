import { describe, it, expect } from 'vitest'
import {
  defaultScanTier,
  getZoneScanTier,
  TIER_1_ZONES,
  type MonitoringZone,
} from '@/lib/gap-score/zones/tier-1-zones'

describe('zone scanTier helpers', () => {
  it('defaultScanTier: chokepoints → 1', () => {
    expect(defaultScanTier('chokepoint')).toBe(1)
  })

  it('defaultScanTier: crude + lng (export/import) → 2', () => {
    expect(defaultScanTier('crude_export')).toBe(2)
    expect(defaultScanTier('crude_import')).toBe(2)
    expect(defaultScanTier('lng_export')).toBe(2)
    expect(defaultScanTier('lng_import')).toBe(2)
  })

  it('defaultScanTier: grain/metals/container/refined → 3', () => {
    expect(defaultScanTier('grain')).toBe(3)
    expect(defaultScanTier('metals')).toBe(3)
    expect(defaultScanTier('container')).toBe(3)
    expect(defaultScanTier('refined_products')).toBe(3)
  })

  it('getZoneScanTier uses explicit override when present', () => {
    const zone: MonitoringZone = {
      id: 'z',
      name: 'test',
      country: 'US',
      region: 'test',
      category: 'chokepoint',
      boundingBox: { minLat: 0, maxLat: 1, minLong: 0, maxLong: 1 },
      relevantCommodities: [],
      shipTypeFilter: [],
      scanTier: 3, // explicit override beats category default
    }
    expect(getZoneScanTier(zone)).toBe(3)
  })

  it('getZoneScanTier falls back to category default when unset', () => {
    const zone: MonitoringZone = {
      id: 'z',
      name: 'test',
      country: 'US',
      region: 'test',
      category: 'chokepoint',
      boundingBox: { minLat: 0, maxLat: 1, minLong: 0, maxLong: 1 },
      relevantCommodities: [],
      shipTypeFilter: [],
    }
    expect(getZoneScanTier(zone)).toBe(1)
  })

  it('every Tier-1 zone resolves to a valid scan tier (1/2/3)', () => {
    for (const zone of TIER_1_ZONES) {
      const t = getZoneScanTier(zone)
      expect([1, 2, 3]).toContain(t)
    }
  })
})
