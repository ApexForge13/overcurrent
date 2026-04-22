import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  FOMC_MEETING_DATES,
  lastKnownFomcDate,
  isInFomcQuietPeriod,
  maybeEmitFomcStaleHeartbeat,
  getEntitiesInEarningsQuietPeriod,
} from '@/lib/gap-score/triggers/narrative/quiet-period-calendar'

describe('quiet-period calendar', () => {
  it('isInFomcQuietPeriod: true when within 24h of any FOMC date', () => {
    // 2026-04-29 is in FOMC_MEETING_DATES
    const onDay = new Date('2026-04-29T14:00:00Z')
    expect(isInFomcQuietPeriod(onDay)).toBe(true)
    // 12h before
    const before = new Date('2026-04-29T02:00:00Z')
    expect(isInFomcQuietPeriod(before)).toBe(true)
  })

  it('isInFomcQuietPeriod: false when >24h from all FOMC dates', () => {
    const farBefore = new Date('2026-04-25T14:00:00Z') // 4 days before
    expect(isInFomcQuietPeriod(farBefore)).toBe(false)
  })

  it('lastKnownFomcDate matches final entry in array', () => {
    const last = lastKnownFomcDate()
    const expected = new Date(`${FOMC_MEETING_DATES[FOMC_MEETING_DATES.length - 1]}T14:00:00Z`)
    expect(last.toISOString()).toBe(expected.toISOString())
  })

  it('maybeEmitFomcStaleHeartbeat: writes nothing if now <= lastKnown', async () => {
    const prisma = {
      costLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient
    const result = await maybeEmitFomcStaleHeartbeat(prisma, new Date('2026-04-22T12:00:00Z'))
    expect(result.stale).toBe(false)
    expect(prisma.costLog.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('maybeEmitFomcStaleHeartbeat: writes heartbeat when now past lastKnown', async () => {
    const prisma = {
      costLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient
    const farFuture = new Date('2028-01-01T00:00:00Z')
    const result = await maybeEmitFomcStaleHeartbeat(prisma, farFuture)
    expect(result.stale).toBe(true)
    const create = prisma.costLog.create as ReturnType<typeof vi.fn>
    expect(create).toHaveBeenCalled()
    const args = (create.mock.calls[0][0] as { data: { operation: string; metadata: Record<string, unknown> } }).data
    expect(args.operation).toBe('fomc-calendar-stale')
    expect(args.metadata.lastKnownFomcDate).toBeTruthy()
  })

  it('maybeEmitFomcStaleHeartbeat: dedupes within 1h of prior', async () => {
    const prisma = {
      costLog: {
        findFirst: vi.fn().mockResolvedValue({ id: 'prior' }),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient
    const farFuture = new Date('2028-01-01T00:00:00Z')
    const result = await maybeEmitFomcStaleHeartbeat(prisma, farFuture)
    expect(result.stale).toBe(true) // still reported as stale
    expect(prisma.costLog.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('getEntitiesInEarningsQuietPeriod: returns set of IDs in ±24h window', async () => {
    const prisma = {
      earningsSchedule: {
        findMany: vi.fn().mockResolvedValue([
          { entityId: 'e1' },
          { entityId: 'e2' },
        ]),
      },
    } as unknown as PrismaClient
    const result = await getEntitiesInEarningsQuietPeriod(
      prisma,
      ['e1', 'e2', 'e3'],
      new Date('2026-04-22T12:00:00Z'),
    )
    expect(result.has('e1')).toBe(true)
    expect(result.has('e2')).toBe(true)
    expect(result.has('e3')).toBe(false)
  })

  it('getEntitiesInEarningsQuietPeriod: empty input returns empty set without query', async () => {
    const prisma = {
      earningsSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient
    const result = await getEntitiesInEarningsQuietPeriod(prisma, [], new Date())
    expect(result.size).toBe(0)
    expect(prisma.earningsSchedule.findMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })
})
