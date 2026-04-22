import { describe, it, expect, vi } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/gap-score/triggers/ground-truth/maritime-zone-scanner', () => ({
  runMaritimeZoneScan: vi.fn(),
}))

import {
  maritimeAnomalyTrigger,
  classifyZoneAnomalyDirection,
} from '@/lib/gap-score/triggers/ground-truth/maritime-anomaly'
import { runMaritimeZoneScan } from '@/lib/gap-score/triggers/ground-truth/maritime-zone-scanner'

const scanMock = vi.mocked(runMaritimeZoneScan)

function makePrisma(opts: {
  baselines?: Array<{ zoneId: string; metricName: string; mean: number; stddev: number }>
  entities?: Array<{ id: string; identifier: string }>
} = {}): TriggerContext['prisma'] {
  return {
    zoneBaseline: {
      findMany: vi.fn().mockResolvedValue(opts.baselines ?? []),
    },
    trackedEntity: {
      findMany: vi.fn().mockResolvedValue(opts.entities ?? []),
    },
  } as unknown as TriggerContext['prisma']
}

describe('classifyZoneAnomalyDirection', () => {
  it('crude_export buildup → -1 (oversupply)', () => {
    expect(classifyZoneAnomalyDirection('crude_export', 'buildup')).toBe(-1)
  })
  it('crude_export drawdown → +1 (tight supply)', () => {
    expect(classifyZoneAnomalyDirection('crude_export', 'drawdown')).toBe(1)
  })
  it('crude_import buildup → +1 (demand arriving)', () => {
    expect(classifyZoneAnomalyDirection('crude_import', 'buildup')).toBe(1)
  })
  it('crude_import drawdown → -1 (demand soft)', () => {
    expect(classifyZoneAnomalyDirection('crude_import', 'drawdown')).toBe(-1)
  })
  it('chokepoint → 0 (direction-agnostic)', () => {
    expect(classifyZoneAnomalyDirection('chokepoint', 'buildup')).toBe(0)
    expect(classifyZoneAnomalyDirection('chokepoint', 'drawdown')).toBe(0)
  })
})

describe('T-GT7 maritime anomaly trigger', () => {
  it('returns [] when scanner returns no scans', async () => {
    scanMock.mockResolvedValueOnce({
      zonesScanned: 0,
      zonesSkipped: 0,
      scans: [],
      keyMissing: true,
      scanningDisabled: true,
      fetchErrors: 0,
    })
    const ctx: TriggerContext = { now: new Date(), prisma: makePrisma() }
    const fires = await maritimeAnomalyTrigger(ctx)
    expect(fires).toEqual([])
  })

  it('fires per commodity when tanker count is >2σ above baseline in crude_export zone', async () => {
    scanMock.mockResolvedValueOnce({
      zonesScanned: 1,
      zonesSkipped: 0,
      scans: [{
        zoneId: 'ras_tanura',
        tankerCount: 30,
        containerShipCount: 0,
        bulkCarrierCount: 0,
        lngCarrierCount: 0,
        totalVessels: 30,
        scanAt: new Date(),
      }],
      keyMissing: false,
      scanningDisabled: false,
      fetchErrors: 0,
    })
    const ctx: TriggerContext = {
      now: new Date(),
      prisma: makePrisma({
        baselines: [
          { zoneId: 'ras_tanura', metricName: 'tankerCount', mean: 10, stddev: 5 },
        ],
        entities: [
          { id: 'e-cl', identifier: 'CL=F' },
          { id: 'e-bz', identifier: 'BZ=F' },
        ],
      }),
    }
    const fires = await maritimeAnomalyTrigger(ctx)
    // z = (30-10)/5 = 4; severity = min(4/4, 1.0) = 1.0
    // 2 commodities (CL=F + BZ=F) × 1 anomaly = 2 fires
    expect(fires).toHaveLength(2)
    expect(fires[0].severity).toBe(1.0)
    expect((fires[0].metadata as { direction: number }).direction).toBe(-1) // crude_export buildup
  })

  it('does NOT fire when |z| < 2', async () => {
    scanMock.mockResolvedValueOnce({
      zonesScanned: 1,
      zonesSkipped: 0,
      scans: [{
        zoneId: 'ras_tanura',
        tankerCount: 13, // mean=10, stddev=5, z=0.6
        containerShipCount: 0,
        bulkCarrierCount: 0,
        lngCarrierCount: 0,
        totalVessels: 13,
        scanAt: new Date(),
      }],
      keyMissing: false,
      scanningDisabled: false,
      fetchErrors: 0,
    })
    const ctx: TriggerContext = {
      now: new Date(),
      prisma: makePrisma({
        baselines: [{ zoneId: 'ras_tanura', metricName: 'tankerCount', mean: 10, stddev: 5 }],
        entities: [{ id: 'e-cl', identifier: 'CL=F' }],
      }),
    }
    const fires = await maritimeAnomalyTrigger(ctx)
    expect(fires).toHaveLength(0)
  })

  it('skips zones with no mature baseline', async () => {
    scanMock.mockResolvedValueOnce({
      zonesScanned: 1,
      zonesSkipped: 0,
      scans: [{
        zoneId: 'ras_tanura',
        tankerCount: 50,
        containerShipCount: 0,
        bulkCarrierCount: 0,
        lngCarrierCount: 0,
        totalVessels: 50,
        scanAt: new Date(),
      }],
      keyMissing: false,
      scanningDisabled: false,
      fetchErrors: 0,
    })
    const ctx: TriggerContext = {
      now: new Date(),
      prisma: makePrisma({
        baselines: [], // no baselines returned → all zones immature
        entities: [{ id: 'e-cl', identifier: 'CL=F' }],
      }),
    }
    const fires = await maritimeAnomalyTrigger(ctx)
    expect(fires).toHaveLength(0)
  })
})
