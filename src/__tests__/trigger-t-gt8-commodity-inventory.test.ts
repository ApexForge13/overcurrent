import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'
import { commodityInventoryTrigger } from '@/lib/gap-score/triggers/ground-truth/commodity-inventory'

interface Release {
  id: string
  indicator: string
  releaseDate: Date
  actualValue: number | null
  consensusValue: number | null
  surpriseZscore: number | null
  unit: string
}

function ctx(opts: {
  configs?: Array<{
    indicator: string
    historicalStddev: number
    directionMapping: Record<string, { positive: number; negative: number }>
    relevantAssets: string[]
  }>
  releases?: Release[]
  entities?: Array<{ id: string; identifier: string }>
  existingFires?: Array<{ metadata: Record<string, unknown> }>
}): TriggerContext {
  return {
    now: new Date('2026-04-22T12:00:00Z'),
    prisma: {
      macroIndicatorConfig: {
        findMany: vi.fn().mockResolvedValue(opts.configs ?? []),
      },
      macroRelease: {
        findMany: vi.fn().mockResolvedValue(opts.releases ?? []),
      },
      triggerEvent: {
        findMany: vi.fn().mockResolvedValue(opts.existingFires ?? []),
      },
      trackedEntity: {
        findMany: vi.fn().mockResolvedValue(opts.entities ?? []),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-GT8 commodity inventory', () => {
  it('fires when |z| > 1 for EIA crude build surprise (bearish oil)', async () => {
    const fires = await commodityInventoryTrigger(
      ctx({
        configs: [{
          indicator: 'EIA_CRUDE',
          historicalStddev: 2_000, // k bbl
          directionMapping: {
            'CL=F': { positive: -1, negative: 1 },
            'BZ=F': { positive: -1, negative: 1 },
          },
          relevantAssets: ['CL=F', 'BZ=F'],
        }],
        releases: [{
          id: 'r1',
          indicator: 'EIA_CRUDE',
          releaseDate: new Date('2026-04-22T10:30:00Z'),
          actualValue: 10_000, // big build
          consensusValue: 5_000,
          surpriseZscore: 2.5, // (10k-5k)/2k = 2.5
          unit: 'k bbl',
        }],
        entities: [
          { id: 'e-cl', identifier: 'CL=F' },
          { id: 'e-bz', identifier: 'BZ=F' },
        ],
      }),
    )
    expect(fires).toHaveLength(2)
    // build surprise positive → direction.positive applied → CL+BZ = -1
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1)
    // severity = min(2.5/3, 1.0) = 0.833
    expect(fires[0].severity).toBeCloseTo(0.833, 2)
  })

  it('does NOT fire when |z| < 1', async () => {
    const fires = await commodityInventoryTrigger(
      ctx({
        configs: [{
          indicator: 'EIA_CRUDE',
          historicalStddev: 2_000,
          directionMapping: { 'CL=F': { positive: -1, negative: 1 } },
          relevantAssets: ['CL=F'],
        }],
        releases: [{
          id: 'r1',
          indicator: 'EIA_CRUDE',
          releaseDate: new Date('2026-04-22T10:30:00Z'),
          actualValue: 5_500,
          consensusValue: 5_000,
          surpriseZscore: 0.25, // well below 1σ
          unit: 'k bbl',
        }],
        entities: [{ id: 'e-cl', identifier: 'CL=F' }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('USDA stub: null consensusValue → filtered out (0 fires)', async () => {
    const fires = await commodityInventoryTrigger(
      ctx({
        configs: [{
          indicator: 'USDA_WHEAT',
          historicalStddev: 100,
          directionMapping: { 'ZW=F': { positive: -1, negative: 1 } },
          relevantAssets: ['ZW=F'],
        }],
        releases: [], // findMany with consensusValue not null returns empty for USDA
        entities: [{ id: 'e-zw', identifier: 'ZW=F' }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('direction -1 on draw surprise (actual < consensus) for crude', async () => {
    const fires = await commodityInventoryTrigger(
      ctx({
        configs: [{
          indicator: 'EIA_CRUDE',
          historicalStddev: 2_000,
          directionMapping: { 'CL=F': { positive: -1, negative: 1 } },
          relevantAssets: ['CL=F'],
        }],
        releases: [{
          id: 'r1',
          indicator: 'EIA_CRUDE',
          releaseDate: new Date(),
          actualValue: -5_000, // draw
          consensusValue: 2_000, // expected build
          surpriseZscore: -3.5,
          unit: 'k bbl',
        }],
        entities: [{ id: 'e-cl', identifier: 'CL=F' }],
      }),
    )
    // surprise negative → direction.negative = +1 (crude draw = bullish oil)
    expect((fires[0].metadata as { direction: number }).direction).toBe(1)
  })

  it('dedupes on (indicator, releaseDate) via existing fire metadata', async () => {
    const releaseDate = new Date('2026-04-22T10:30:00Z')
    const fires = await commodityInventoryTrigger(
      ctx({
        configs: [{
          indicator: 'EIA_CRUDE',
          historicalStddev: 2_000,
          directionMapping: { 'CL=F': { positive: -1, negative: 1 } },
          relevantAssets: ['CL=F'],
        }],
        releases: [{
          id: 'r1',
          indicator: 'EIA_CRUDE',
          releaseDate,
          actualValue: 10_000,
          consensusValue: 5_000,
          surpriseZscore: 2.5,
          unit: 'k bbl',
        }],
        entities: [{ id: 'e-cl', identifier: 'CL=F' }],
        existingFires: [{
          metadata: { indicator: 'EIA_CRUDE', release_date: releaseDate.toISOString() },
        }],
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('skips unmapped relevantAsset identifiers', async () => {
    const fires = await commodityInventoryTrigger(
      ctx({
        configs: [{
          indicator: 'EIA_CRUDE',
          historicalStddev: 2_000,
          directionMapping: {
            'CL=F': { positive: -1, negative: 1 },
            'UNMAPPED=F': { positive: -1, negative: 1 },
          },
          relevantAssets: ['CL=F', 'UNMAPPED=F'],
        }],
        releases: [{
          id: 'r1',
          indicator: 'EIA_CRUDE',
          releaseDate: new Date(),
          actualValue: 10_000,
          consensusValue: 5_000,
          surpriseZscore: 2.5,
          unit: 'k bbl',
        }],
        entities: [{ id: 'e-cl', identifier: 'CL=F' }], // UNMAPPED missing
      }),
    )
    expect(fires).toHaveLength(1) // only CL=F
  })

  it('empty configs → 0 fires (early return)', async () => {
    const fires = await commodityInventoryTrigger(ctx({ configs: [], releases: [] }))
    expect(fires).toHaveLength(0)
  })
})
