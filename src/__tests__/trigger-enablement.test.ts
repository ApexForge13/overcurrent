import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  isTriggerEnabledWithFallback,
  getThresholdOverrides,
  clearEnablementCache,
} from '@/lib/gap-score/triggers/enablement'

function makePrisma(rows: Array<{ triggerId: string; enabled: boolean; thresholdOverrides: unknown }>): PrismaClient {
  return {
    triggerEnablement: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaClient
}

describe('TriggerEnablement resolution chain', () => {
  beforeEach(() => {
    clearEnablementCache()
  })

  it('DB-set enabled=true wins over env DISABLED', async () => {
    const prisma = makePrisma([
      { triggerId: 'T-N1', enabled: true, thresholdOverrides: null },
    ])
    const env: Record<string, string | undefined> = { TRIGGER_T_N1_ENABLED: 'false' }
    const result = await isTriggerEnabledWithFallback(prisma, 'T-N1', env)
    expect(result).toBe(true)
  })

  it('DB-set enabled=false wins over env ENABLED', async () => {
    const prisma = makePrisma([
      { triggerId: 'T-N1', enabled: false, thresholdOverrides: null },
    ])
    const env: Record<string, string | undefined> = { TRIGGER_T_N1_ENABLED: 'true' }
    const result = await isTriggerEnabledWithFallback(prisma, 'T-N1', env)
    expect(result).toBe(false)
  })

  it('No DB row + env=true → enabled', async () => {
    const prisma = makePrisma([])
    const result = await isTriggerEnabledWithFallback(prisma, 'T-N1', { TRIGGER_T_N1_ENABLED: 'true' })
    expect(result).toBe(true)
  })

  it('No DB row + env=false → disabled', async () => {
    const prisma = makePrisma([])
    const result = await isTriggerEnabledWithFallback(prisma, 'T-N1', { TRIGGER_T_N1_ENABLED: 'false' })
    expect(result).toBe(false)
  })

  it('No DB row + no env → ENABLED default (manifest A3)', async () => {
    const prisma = makePrisma([])
    const result = await isTriggerEnabledWithFallback(prisma, 'T-N1', {})
    expect(result).toBe(true)
  })

  it('getThresholdOverrides returns DB JSON or null', async () => {
    const prisma = makePrisma([
      { triggerId: 'T-N1', enabled: true, thresholdOverrides: { z_floor: 2.5, abs_floor: 7 } },
    ])
    const overrides = await getThresholdOverrides(prisma, 'T-N1')
    expect(overrides).toEqual({ z_floor: 2.5, abs_floor: 7 })
  })

  it('getThresholdOverrides returns null when no row exists', async () => {
    const prisma = makePrisma([])
    const overrides = await getThresholdOverrides(prisma, 'T-N1')
    expect(overrides).toBeNull()
  })

  it('cache: subsequent calls within TTL do not re-query DB', async () => {
    const prisma = makePrisma([
      { triggerId: 'T-N1', enabled: true, thresholdOverrides: null },
    ])
    const findMany = prisma.triggerEnablement.findMany as ReturnType<typeof vi.fn>
    await isTriggerEnabledWithFallback(prisma, 'T-N1')
    await isTriggerEnabledWithFallback(prisma, 'T-N1')
    await getThresholdOverrides(prisma, 'T-N1')
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('clearEnablementCache forces refresh on next call', async () => {
    const prisma = makePrisma([
      { triggerId: 'T-N1', enabled: true, thresholdOverrides: null },
    ])
    const findMany = prisma.triggerEnablement.findMany as ReturnType<typeof vi.fn>
    await isTriggerEnabledWithFallback(prisma, 'T-N1')
    clearEnablementCache()
    await isTriggerEnabledWithFallback(prisma, 'T-N1')
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('drops non-numeric threshold values silently', async () => {
    const prisma = makePrisma([
      { triggerId: 'T-N1', enabled: true, thresholdOverrides: { z_floor: 2.5, bogus: 'string', other: NaN } },
    ])
    const overrides = await getThresholdOverrides(prisma, 'T-N1')
    expect(overrides).toEqual({ z_floor: 2.5 })
  })
})
