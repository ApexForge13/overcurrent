import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/raw-signals/clients/datadocked-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/datadocked-client')
  >('@/lib/raw-signals/clients/datadocked-client')
  return { ...actual, fetchVesselsByArea: vi.fn() }
})

import {
  runMaritimeZoneScan,
  isZoneDue,
} from '@/lib/gap-score/triggers/ground-truth/maritime-zone-scanner'
import { fetchVesselsByArea } from '@/lib/raw-signals/clients/datadocked-client'

const fetchMock = vi.mocked(fetchVesselsByArea)

function makePrisma(opts: { lastScansByZone?: Array<{ zoneId: string; updatedAt: Date }> } = {}): PrismaClient {
  return {
    zoneBaseline: {
      findMany: vi.fn().mockResolvedValue(opts.lastScansByZone ?? []),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    costLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('maritime zone scanner', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    delete process.env.DATADOCKED_API_KEY
    delete process.env.DATADOCKED_SCANNING_ENABLED
  })
  afterEach(() => {
    delete process.env.DATADOCKED_API_KEY
    delete process.env.DATADOCKED_SCANNING_ENABLED
  })

  it('isZoneDue: tier 1 needs 12h gap', () => {
    const now = new Date('2026-04-22T18:00:00Z')
    expect(isZoneDue(1, null, now)).toBe(true)
    expect(isZoneDue(1, new Date('2026-04-22T00:00:00Z'), now)).toBe(true) // 18h ago
    // 6h ago is fresher than the 12h floor → not due
    const six = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    expect(isZoneDue(1, six, now)).toBe(false)
    // Exactly 12h ago — boundary, counts as due
    const twelve = new Date(now.getTime() - 12 * 60 * 60 * 1000)
    expect(isZoneDue(1, twelve, now)).toBe(true)
  })

  it('isZoneDue: tier 3 needs 48h gap', () => {
    const now = new Date('2026-04-22T18:00:00Z')
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    expect(isZoneDue(3, twoDaysAgo, now)).toBe(true)
    expect(isZoneDue(3, oneDayAgo, now)).toBe(false)
  })

  it('returns keyMissing heartbeat when DATADOCKED_API_KEY absent', async () => {
    const prisma = makePrisma()
    const result = await runMaritimeZoneScan(prisma)
    expect(result.keyMissing).toBe(true)
    expect(result.zonesScanned).toBe(0)
    expect(prisma.costLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalled()
  })

  it('returns scanningDisabled heartbeat when DATADOCKED_SCANNING_ENABLED != true', async () => {
    process.env.DATADOCKED_API_KEY = 'key'
    // DATADOCKED_SCANNING_ENABLED not set
    const prisma = makePrisma()
    const result = await runMaritimeZoneScan(prisma)
    expect(result.keyMissing).toBe(false)
    expect(result.scanningDisabled).toBe(true)
    expect(result.zonesScanned).toBe(0)
    const create = prisma.costLog.create as ReturnType<typeof vi.fn>
    const data = (create.mock.calls[0][0] as { data: { operation: string } }).data
    expect(data.operation).toBe('disabled:scanning-flag-off')
  })

  it('scans zones when both gates set, skips recently-scanned zones', async () => {
    process.env.DATADOCKED_API_KEY = 'key'
    process.env.DATADOCKED_SCANNING_ENABLED = 'true'
    fetchMock.mockResolvedValue({ ok: true, value: [] })
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2h ago, too fresh for tier 1
    const prisma = makePrisma({
      lastScansByZone: [{ zoneId: 'ras_tanura', updatedAt: recent }],
    })
    const result = await runMaritimeZoneScan(prisma, new Date())
    expect(result.keyMissing).toBe(false)
    expect(result.scanningDisabled).toBe(false)
    // ras_tanura should be skipped; other zones should run
    expect(result.zonesSkipped).toBeGreaterThanOrEqual(1)
    expect(result.zonesScanned).toBeGreaterThan(0)
  })
})
