import { describe, it, expect, vi } from 'vitest'
import { upsertConsensus } from '@/lib/macro/consensus/upsert'
import type { PrismaClient } from '@prisma/client'

interface MockRow {
  id: string
  actualValue: number | null
  unit: string
  consensusValue: number | null
}

function mockPrisma(opts: {
  existing?: MockRow | null
  configStddev?: number
}): PrismaClient {
  const createMock = vi.fn().mockResolvedValue({})
  const updateMock = vi.fn().mockResolvedValue({})
  return {
    macroRelease: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      create: createMock,
      update: updateMock,
    },
    macroIndicatorConfig: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.configStddev ? { historicalStddev: opts.configStddev } : null),
    },
  } as unknown as PrismaClient
}

describe('consensus upsert', () => {
  it('creates a new MacroRelease when no row exists for (indicator, releaseDate)', async () => {
    const prisma = mockPrisma({ existing: null })
    const outcome = await upsertConsensus(prisma, {
      indicator: 'PAYEMS',
      releaseDate: '2026-05-01',
      consensusValue: 240,
      consensusSource: 'investing.com',
      unit: 'K',
    })
    expect(outcome.created).toBe(true)
    expect(outcome.surpriseComputed).toBe(false) // no actual yet
    expect(prisma.macroRelease.create).toHaveBeenCalledTimes(1)
  })

  it('updates existing row without overwriting actualValue with null', async () => {
    const prisma = mockPrisma({
      existing: { id: 'r1', actualValue: 275, unit: 'K', consensusValue: null },
      configStddev: 30,
    })
    const outcome = await upsertConsensus(prisma, {
      indicator: 'PAYEMS',
      releaseDate: '2026-05-01',
      consensusValue: 240,
      consensusSource: 'investing.com',
      unit: 'K',
    })
    expect(outcome.created).toBe(false)
    expect(outcome.surpriseComputed).toBe(true) // actual preserved → surprise computes
    const updateCall = (prisma.macroRelease.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.actualValue).toBe(275) // preserved
    expect(updateCall.data.consensusValue).toBe(240)
    expect(updateCall.data.surprise).toBe(35) // 275 - 240
    expect(updateCall.data.surpriseZscore).toBeCloseTo(35 / 30, 4)
  })

  it('records consensus source correctly on new create (trading_economics)', async () => {
    const prisma = mockPrisma({ existing: null })
    await upsertConsensus(prisma, {
      indicator: 'CPIAUCSL',
      releaseDate: '2026-05-10',
      consensusValue: 4.5,
      consensusSource: 'trading_economics',
    })
    const createCall = (prisma.macroRelease.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createCall.data.consensusSource).toBe('trading_economics')
  })

  it('is idempotent on repeat — second call updates, does not create again', async () => {
    const prisma = mockPrisma({
      existing: { id: 'r1', actualValue: null, unit: 'K', consensusValue: 240 },
    })
    const outcome = await upsertConsensus(prisma, {
      indicator: 'PAYEMS',
      releaseDate: '2026-05-01',
      consensusValue: 245, // revised forecast
      consensusSource: 'investing.com',
    })
    expect(outcome.created).toBe(false)
    const updateCall = (prisma.macroRelease.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateCall.data.consensusValue).toBe(245)
  })
})
