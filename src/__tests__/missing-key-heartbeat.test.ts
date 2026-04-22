import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'

function mockPrisma(opts: { recent?: { id: string } | null } = {}): PrismaClient {
  return {
    costLog: {
      findFirst: vi.fn().mockResolvedValue(opts.recent ?? null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('writeMissingKeyHeartbeat', () => {
  it('writes a CostLog row when no recent heartbeat exists', async () => {
    const prisma = mockPrisma({ recent: null })
    const result = await writeMissingKeyHeartbeat(prisma, 'polygon', 'POLYGON_API_KEY')
    expect(result.wrote).toBe(true)
    const create = prisma.costLog.create as ReturnType<typeof vi.fn>
    expect(create).toHaveBeenCalledTimes(1)
    const args = (create.mock.calls[0][0] as { data: { service: string; operation: string; metadata: Record<string, unknown> } }).data
    expect(args.service).toBe('polygon')
    expect(args.operation).toBe('disabled:missing-key')
    expect(args.metadata.envVar).toBe('POLYGON_API_KEY')
  })

  it('skips writing when a recent heartbeat is within dedup window', async () => {
    const prisma = mockPrisma({ recent: { id: 'r1' } })
    const result = await writeMissingKeyHeartbeat(prisma, 'polygon', 'POLYGON_API_KEY')
    expect(result.wrote).toBe(false)
    const create = prisma.costLog.create as ReturnType<typeof vi.fn>
    expect(create).not.toHaveBeenCalled()
  })

  it('queries with correct service + operation filter', async () => {
    const prisma = mockPrisma()
    await writeMissingKeyHeartbeat(prisma, 'dcf', 'DCF_API_KEY')
    const findFirst = prisma.costLog.findFirst as ReturnType<typeof vi.fn>
    const args = findFirst.mock.calls[0][0] as { where: { service: string; operation: string } }
    expect(args.where.service).toBe('dcf')
    expect(args.where.operation).toBe('disabled:missing-key')
  })
})
