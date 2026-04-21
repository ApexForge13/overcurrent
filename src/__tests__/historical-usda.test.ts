import { describe, expect, it } from 'vitest'
import { fetchUsdaSeries, USDA_INDICATORS } from '@/lib/historical-data/usda-client'

describe('USDA client (Phase 1b stub)', () => {
  it('exposes WASDE corn/soy/wheat indicators', () => {
    const ids = USDA_INDICATORS.map((i) => i.seriesId)
    expect(ids).toContain('USDA_WASDE_CORN')
    expect(ids).toContain('USDA_WASDE_SOY')
    expect(ids).toContain('USDA_WASDE_WHEAT')
  })

  it('fetchUsdaSeries returns [] in Phase 1b stub', async () => {
    for (const spec of USDA_INDICATORS) {
      expect(await fetchUsdaSeries(spec)).toEqual([])
    }
  })
})
