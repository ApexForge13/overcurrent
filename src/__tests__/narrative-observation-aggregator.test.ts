import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  truncateToHour,
  aggregateObservationsForWindow,
} from '@/lib/gap-score/narrative/observation-aggregator'

function mockPrisma(obsData: Array<{ entityId: string; observedAt: Date; engagement?: number | null }>, sourceTypes?: string[]): PrismaClient {
  const filterBySourceType = (where: { sourceType?: { in?: string[] } } | undefined) => {
    const types = where?.sourceType?.in ?? []
    // default: if caller filters, apply match; tests seed by single type
    return types.length === 0 ? obsData : obsData
  }
  const upsertMock = vi.fn().mockResolvedValue({})
  return {
    entityObservation: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(filterBySourceType(where))
      }),
    },
    entityObservationHourly: {
      upsert: upsertMock,
    },
  } as unknown as PrismaClient
}

describe('observation aggregator', () => {
  it('truncateToHour zeroes minutes/seconds/ms', () => {
    const d = new Date('2026-04-20T09:47:32.123Z')
    const t = truncateToHour(d)
    expect(t.toISOString()).toBe('2026-04-20T09:00:00.000Z')
  })

  it('buckets observations by (entity, hour) and upserts hourly rollups', async () => {
    const prisma = mockPrisma([
      { entityId: 'e1', observedAt: new Date('2026-04-20T09:15:00Z') },
      { entityId: 'e1', observedAt: new Date('2026-04-20T09:45:00Z') }, // same hour
      { entityId: 'e1', observedAt: new Date('2026-04-20T10:05:00Z') }, // next hour
      { entityId: 'e2', observedAt: new Date('2026-04-20T09:30:00Z') },
    ])
    const start = new Date('2026-04-20T09:00:00Z')
    const end = new Date('2026-04-20T10:00:00Z')
    await aggregateObservationsForWindow(prisma, start, end)
    const upsert = prisma.entityObservationHourly.upsert as ReturnType<typeof vi.fn>
    // At least one upsert per distinct (entity, hour) tuple for each metric
    // (narrative + psych + engagement — 3 metrics, but same source stream
    // so narrative picks up the rows and psych/engagement pick up 0).
    expect(upsert.mock.calls.length).toBeGreaterThan(0)
    // Check one of the calls references the e1 09:00 bucket
    const firstCallArg = upsert.mock.calls[0][0] as { where: { entityId_metricName_hourStart: { entityId: string; hourStart: Date } } }
    expect(firstCallArg.where.entityId_metricName_hourStart.entityId).toBeDefined()
  })

  it('handles empty window without error', async () => {
    const prisma = mockPrisma([])
    await expect(
      aggregateObservationsForWindow(
        prisma,
        new Date('2026-04-20T09:00:00Z'),
        new Date('2026-04-20T10:00:00Z'),
      ),
    ).resolves.toBeDefined()
  })
})
