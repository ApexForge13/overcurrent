import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { recomputePsychBaselines } from '@/lib/gap-score/psychological/psych-baseline-worker'

function mockPrisma(rollups: Array<{ entityId: string; count: number }>, existingIsMature?: boolean): PrismaClient {
  return {
    entityObservationHourly: {
      findMany: vi.fn().mockResolvedValue(rollups),
    },
    entityBaseline: {
      findUnique: vi.fn().mockResolvedValue(existingIsMature === undefined ? null : { isMature: existingIsMature }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('psych baseline worker', () => {
  it('upserts cashtag_velocity_hourly baseline per entity', async () => {
    const rollups = Array.from({ length: 10 }, () => ({ entityId: 'e1', count: 5 }))
    const prisma = mockPrisma(rollups)
    const result = await recomputePsychBaselines(prisma)
    expect(result.cashtagEntitiesEvaluated).toBe(1)
    expect(result.cashtagBaselinesUpserted).toBe(1)
  })

  it('flips isMature when sampleCount >= 240', async () => {
    const rollups = Array.from({ length: 300 }, () => ({ entityId: 'e1', count: 3 }))
    const prisma = mockPrisma(rollups, false)
    const result = await recomputePsychBaselines(prisma)
    expect(result.cashtagMaturityFlipped).toBe(1)
    const upsert = prisma.entityBaseline.upsert as ReturnType<typeof vi.fn>
    const args = upsert.mock.calls[0][0] as { create: { isMature: boolean; windowDays: number } }
    expect(args.create.isMature).toBe(true)
    expect(args.create.windowDays).toBe(14)
  })

  it('keeps isMature=false when sampleCount < 240', async () => {
    const rollups = Array.from({ length: 100 }, () => ({ entityId: 'e1', count: 3 }))
    const prisma = mockPrisma(rollups)
    const result = await recomputePsychBaselines(prisma)
    expect(result.cashtagMaturityFlipped).toBe(0)
  })

  it('handles empty rollups', async () => {
    const prisma = mockPrisma([])
    const result = await recomputePsychBaselines(prisma)
    expect(result.cashtagEntitiesEvaluated).toBe(0)
  })
})
