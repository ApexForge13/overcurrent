import { describe, expect, it, vi } from 'vitest'
import { macroSurpriseTrigger } from '@/lib/gap-score/triggers/ground-truth/macro-surprise'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

interface Release {
  id: string
  indicator: string
  releaseDate: Date
  actualValue: number | null
  consensusValue: number | null
  surpriseZscore: number | null
  unit: string
}

function makeCtx(opts: {
  releases: Release[]
  existingMetaFires?: Array<{ metadata: Record<string, unknown> }>
  configs?: Array<{
    indicator: string
    historicalStddev: number
    directionMapping: Record<string, { positive: number; negative: number }>
    relevantAssets: string[]
  }>
  entities?: Array<{ id: string; identifier: string }>
}) {
  return {
    now: new Date('2026-04-21T12:00:00Z'),
    prisma: {
      macroRelease: { findMany: vi.fn().mockResolvedValue(opts.releases) },
      triggerEvent: { findMany: vi.fn().mockResolvedValue(opts.existingMetaFires ?? []) },
      macroIndicatorConfig: { findMany: vi.fn().mockResolvedValue(opts.configs ?? []) },
      trackedEntity: { findMany: vi.fn().mockResolvedValue(opts.entities ?? []) },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-GT9 macro surprise', () => {
  it('returns [] when no releases in window (Phase 1c.1 dormant state)', async () => {
    const fires = await macroSurpriseTrigger(makeCtx({ releases: [] }))
    expect(fires).toEqual([])
  })

  it('returns [] when consensus is null (dormant until Phase 1c.2)', async () => {
    const fires = await macroSurpriseTrigger(
      makeCtx({
        releases: [{
          id: 'r1', indicator: 'PAYEMS', releaseDate: new Date(),
          actualValue: 200, consensusValue: null, surpriseZscore: null, unit: 'K jobs',
        }],
      }),
    )
    expect(fires).toEqual([])
  })

  it('does NOT fire when |z-score| < 1σ floor', async () => {
    const fires = await macroSurpriseTrigger(
      makeCtx({
        releases: [{
          id: 'r1', indicator: 'PAYEMS', releaseDate: new Date(),
          actualValue: 205, consensusValue: 200, surpriseZscore: null, unit: 'K jobs',
        }],
        configs: [{
          indicator: 'PAYEMS', historicalStddev: 50,
          directionMapping: { SPY: { positive: 1, negative: -1 } },
          relevantAssets: ['SPY'],
        }],
        entities: [{ id: 'spy-id', identifier: 'SPY' }],
      }),
    )
    // surprise = 5, z-score = 5/50 = 0.1 → below 1σ floor
    expect(fires).toEqual([])
  })

  it('fires when |z-score| > 1σ, direction from positive mapping', async () => {
    const fires = await macroSurpriseTrigger(
      makeCtx({
        releases: [{
          id: 'r1', indicator: 'PAYEMS', releaseDate: new Date('2026-04-20T08:30:00Z'),
          actualValue: 300, consensusValue: 200, surpriseZscore: null, unit: 'K jobs',
        }],
        configs: [{
          indicator: 'PAYEMS', historicalStddev: 50,
          directionMapping: {
            SPY: { positive: 1, negative: -1 },
            TLT: { positive: -1, negative: 1 },
          },
          relevantAssets: ['SPY', 'TLT'],
        }],
        entities: [
          { id: 'spy-id', identifier: 'SPY' },
          { id: 'tlt-id', identifier: 'TLT' },
        ],
      }),
    )
    // surprise = 100, z = 100/50 = 2σ → fires for both assets
    expect(fires).toHaveLength(2)
    const spy = fires.find((f) => f.entityId === 'spy-id')
    const tlt = fires.find((f) => f.entityId === 'tlt-id')
    expect(spy?.metadata.direction).toBe(1) // positive surprise, SPY positive → +1
    expect(tlt?.metadata.direction).toBe(-1) // positive surprise, TLT negative → -1
  })

  it('skips entity identifiers not in TrackedEntity', async () => {
    const fires = await macroSurpriseTrigger(
      makeCtx({
        releases: [{
          id: 'r1', indicator: 'PAYEMS', releaseDate: new Date(),
          actualValue: 300, consensusValue: 200, surpriseZscore: null, unit: 'K jobs',
        }],
        configs: [{
          indicator: 'PAYEMS', historicalStddev: 50,
          directionMapping: { UNKNOWN_TICKER: { positive: 1, negative: -1 } },
          relevantAssets: ['UNKNOWN_TICKER'],
        }],
        entities: [], // no match
      }),
    )
    expect(fires).toEqual([])
  })

  it('deduplicates: skips releases where META-like fire already exists in window', async () => {
    const releaseDate = new Date('2026-04-20T08:30:00Z')
    const fires = await macroSurpriseTrigger(
      makeCtx({
        releases: [{
          id: 'r1', indicator: 'PAYEMS', releaseDate,
          actualValue: 300, consensusValue: 200, surpriseZscore: null, unit: 'K jobs',
        }],
        existingMetaFires: [
          { metadata: { indicator: 'PAYEMS', release_date: releaseDate.toISOString() } },
        ],
        configs: [{
          indicator: 'PAYEMS', historicalStddev: 50,
          directionMapping: { SPY: { positive: 1, negative: -1 } },
          relevantAssets: ['SPY'],
        }],
        entities: [{ id: 'spy-id', identifier: 'SPY' }],
      }),
    )
    expect(fires).toEqual([])
  })
})
