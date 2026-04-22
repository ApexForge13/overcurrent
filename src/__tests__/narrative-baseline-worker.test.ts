import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  recomputeNarrativeBaselines,
  computeStats,
} from '@/lib/gap-score/narrative/narrative-baseline-worker'

function mockPrisma(rollups: Array<{ entityId: string; count: number }>, existingBaseline?: { entityId: string; isMature: boolean }): PrismaClient {
  return {
    entityObservationHourly: {
      findMany: vi.fn().mockResolvedValue(rollups),
    },
    entityBaseline: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const id = where?.entityId_metricName_windowDays?.entityId
        if (existingBaseline && existingBaseline.entityId === id) {
          return Promise.resolve({ isMature: existingBaseline.isMature })
        }
        return Promise.resolve(null)
      }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('narrative baseline worker', () => {
  it('computeStats: mean, stddev, sampleCount on a simple series', () => {
    const s = computeStats([2, 4, 4, 4, 5, 5, 7, 9])
    expect(s.sampleCount).toBe(8)
    expect(s.mean).toBe(5)
    // Population stddev of this series is 2.0 exactly
    expect(s.stddev).toBeCloseTo(2, 5)
  })

  it('computeStats: empty series returns zeros', () => {
    expect(computeStats([])).toEqual({ mean: 0, stddev: 0, sampleCount: 0 })
  })

  it('upserts baseline for each entity with observations', async () => {
    const rollups = Array.from({ length: 50 }, (_, i) => ({
      entityId: 'e1',
      count: 3 + (i % 5),
    })).concat(Array.from({ length: 30 }, () => ({ entityId: 'e2', count: 2 })))
    const prisma = mockPrisma(rollups)
    const result = await recomputeNarrativeBaselines(prisma)
    expect(result.entitiesEvaluated).toBe(2)
    expect(result.baselinesUpserted).toBe(2)
  })

  it('flips isMature when sampleCount >= 120', async () => {
    const rollups = Array.from({ length: 150 }, () => ({ entityId: 'e1', count: 3 }))
    const prisma = mockPrisma(rollups)
    const result = await recomputeNarrativeBaselines(prisma)
    expect(result.maturityFlipped).toBe(1)
    const upsert = prisma.entityBaseline.upsert as ReturnType<typeof vi.fn>
    const args = upsert.mock.calls[0][0] as { create: { isMature: boolean } }
    expect(args.create.isMature).toBe(true)
  })

  it('keeps isMature=false when sampleCount < 120', async () => {
    const rollups = Array.from({ length: 60 }, () => ({ entityId: 'e1', count: 3 }))
    const prisma = mockPrisma(rollups)
    const result = await recomputeNarrativeBaselines(prisma)
    expect(result.maturityFlipped).toBe(0)
    const upsert = prisma.entityBaseline.upsert as ReturnType<typeof vi.fn>
    const args = upsert.mock.calls[0][0] as { create: { isMature: boolean } }
    expect(args.create.isMature).toBe(false)
  })
})
