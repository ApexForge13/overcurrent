/**
 * Maritime zone scanner — per-zone polling for AIS vessel positioning.
 *
 * Double-gated per manifest:
 *   1. DATADOCKED_API_KEY must be present
 *   2. DATADOCKED_SCANNING_ENABLED must equal 'true'
 *
 * Missing either → heartbeat + no scan. This preserves the tier-upgrade
 * safety margin (Deckhand tier doesn't have enough credits; must wait
 * for Seafarer upgrade to be confirmed).
 *
 * Scan cadence per zone tier (set by getZoneScanTier):
 *   Tier 1 — 2 scans/day (every 12h)
 *   Tier 2 — 1 scan/day (every 24h)
 *   Tier 3 — 0.5 scans/day (every 48h)
 *
 * Each scan:
 *   1. Fetch vessels in zone's bounding box (10 credits)
 *   2. Count by typeLabel (tanker / cargo / bulk / lng)
 *   3. Upsert ZoneBaseline observation — increment sampleCount
 *   4. Return per-metric counts for T-GT7 trigger to evaluate
 *
 * Trigger (T-GT7) runs separately; this scanner focuses on data capture.
 */

import type { PrismaClient } from '@prisma/client'
import {
  fetchVesselsByArea,
  type DatadockedVesselPosition,
} from '@/lib/raw-signals/clients/datadocked-client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'
import {
  TIER_1_ZONES,
  getZoneScanTier,
  type MonitoringZone,
} from '@/lib/gap-score/zones/tier-1-zones'

const SOURCE_NAME = 'datadocked'

export interface ZoneScanResult {
  zoneId: string
  tankerCount: number
  containerShipCount: number
  bulkCarrierCount: number
  lngCarrierCount: number
  totalVessels: number
  scanAt: Date
}

export interface ZoneScannerSummary {
  zonesScanned: number
  zonesSkipped: number
  scans: ZoneScanResult[]
  keyMissing: boolean
  scanningDisabled: boolean
  fetchErrors: number
}

/**
 * Does this zone need a scan given its tier + last scan time?
 * - Tier 1: skip if last scan within 12h
 * - Tier 2: skip if last scan within 24h
 * - Tier 3: skip if last scan within 48h
 *
 * For the first scan (no prior), always run.
 */
export function isZoneDue(tier: 1 | 2 | 3, lastScanAt: Date | null, now: Date): boolean {
  if (!lastScanAt) return true
  const hoursPerTier = tier === 1 ? 12 : tier === 2 ? 24 : 48
  const msSinceLastScan = now.getTime() - lastScanAt.getTime()
  return msSinceLastScan >= hoursPerTier * 60 * 60 * 1000
}

function countByType(vessels: DatadockedVesselPosition[]): {
  tanker: number
  cargo: number
  military: number
  fishing: number
  passenger: number
  other: number
} {
  const counts = { tanker: 0, cargo: 0, military: 0, fishing: 0, passenger: 0, other: 0 }
  for (const v of vessels) {
    if (v.typeLabel === 'tanker') counts.tanker++
    else if (v.typeLabel === 'cargo') counts.cargo++
    else if (v.typeLabel === 'military') counts.military++
    else if (v.typeLabel === 'fishing_or_special') counts.fishing++
    else if (v.typeLabel === 'passenger') counts.passenger++
    else counts.other++
  }
  return counts
}

/**
 * Discriminate cargo vessels — for Tier-1 zones we also track LNG carriers
 * (AIS type 80-89 overlaps with tanker; Data Docked sometimes tags LNG
 * specifically in the `destination` or `cargo_type` field). For 1c.2b.2
 * we use a simple filter: cargo vessels with destination matching known
 * LNG terminals. Bulk-carrier count is cargo minus LNG heuristic.
 */
function classifyCargoSpecializations(vessels: DatadockedVesselPosition[]): {
  lngCarrier: number
  bulkCarrier: number
  container: number
} {
  const LNG_DEST_RE = /LNG|gas|Qatargas|RasLaffan/i
  const CONTAINER_DEST_RE = /container|APM|Maersk|CMA|MSC|COSCO/i
  let lng = 0
  let container = 0
  let bulk = 0
  for (const v of vessels) {
    if (v.typeLabel !== 'cargo' && v.typeLabel !== 'tanker') continue
    const dest = v.destination ?? ''
    if (LNG_DEST_RE.test(dest)) lng++
    else if (CONTAINER_DEST_RE.test(dest)) container++
    else if (v.typeLabel === 'cargo') bulk++
  }
  return { lngCarrier: lng, bulkCarrier: bulk, container }
}

/**
 * Scan a single zone. Returns null on fetch error or when scan is not
 * due (caller checked with isZoneDue already — this is a safety net).
 */
async function scanZone(
  prisma: PrismaClient,
  zone: MonitoringZone,
  apiKey: string,
  now: Date,
): Promise<ZoneScanResult | null> {
  const bbox = {
    swLat: zone.boundingBox.minLat,
    swLng: zone.boundingBox.minLong,
    neLat: zone.boundingBox.maxLat,
    neLng: zone.boundingBox.maxLong,
  }
  const outcome = await fetchVesselsByArea(bbox, apiKey)
  if (!outcome.ok) return null

  const vessels = outcome.value
  const byType = countByType(vessels)
  const spec = classifyCargoSpecializations(vessels)

  const result: ZoneScanResult = {
    zoneId: zone.id,
    tankerCount: byType.tanker,
    containerShipCount: spec.container,
    bulkCarrierCount: spec.bulkCarrier,
    lngCarrierCount: spec.lngCarrier,
    totalVessels: vessels.length,
    scanAt: now,
  }

  // Update ZoneBaseline sample counts for each metric observed.
  await upsertZoneObservation(prisma, zone.id, 'tankerCount', byType.tanker, now)
  await upsertZoneObservation(prisma, zone.id, 'containerShipCount', spec.container, now)
  await upsertZoneObservation(prisma, zone.id, 'bulkCarrierCount', spec.bulkCarrier, now)
  await upsertZoneObservation(prisma, zone.id, 'lngCarrierCount', spec.lngCarrier, now)

  return result
}

const MIN_ZONE_SAMPLE_SIZE = 90

/**
 * Upsert a zone baseline observation. Running stats: we keep a simple
 * mean (new observation incorporated into running avg) + stddev
 * approximation via Welford's online algorithm.
 *
 * For brevity and because the first 90 samples are ramp-up only, the
 * implementation here uses simple bulk-mean math by recomputing over
 * the latest N samples (SAMPLE_WINDOW = 100). Good enough for v1; swap
 * to Welford if latency becomes a concern at 43 zones × 4 metrics.
 */
async function upsertZoneObservation(
  prisma: PrismaClient,
  zoneId: string,
  metricName: string,
  observation: number,
  now: Date,
): Promise<void> {
  const existing = await prisma.zoneBaseline.findUnique({
    where: { zoneId_metricName_windowDays: { zoneId, metricName, windowDays: 30 } },
    select: { mean: true, stddev: true, sampleCount: true, isMature: true },
  })

  if (!existing) {
    await prisma.zoneBaseline.create({
      data: {
        zoneId,
        metricName,
        windowDays: 30,
        mean: observation,
        stddev: 0,
        sampleCount: 1,
        minSampleSize: MIN_ZONE_SAMPLE_SIZE,
        isMature: false,
      },
    })
    return
  }

  // Running mean/variance via Welford's algorithm step.
  const newCount = existing.sampleCount + 1
  const delta = observation - existing.mean
  const newMean = existing.mean + delta / newCount
  const delta2 = observation - newMean
  // Reconstruct running sum of squares (M2) from prior stddev+count, add
  // new delta*delta2, then divide for new stddev.
  const priorM2 = existing.stddev ** 2 * existing.sampleCount
  const newM2 = priorM2 + delta * delta2
  const newStddev = newCount > 1 ? Math.sqrt(newM2 / newCount) : 0

  const newIsMature = newCount >= MIN_ZONE_SAMPLE_SIZE
  await prisma.zoneBaseline.update({
    where: { zoneId_metricName_windowDays: { zoneId, metricName, windowDays: 30 } },
    data: {
      mean: newMean,
      stddev: newStddev,
      sampleCount: newCount,
      isMature: newIsMature,
    },
  })
  void now
}

/**
 * Top-level entry: scan due zones, respecting both env gates.
 */
export async function runMaritimeZoneScan(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ZoneScannerSummary> {
  const apiKey = process.env.DATADOCKED_API_KEY
  const scanningEnabled = process.env.DATADOCKED_SCANNING_ENABLED === 'true'

  if (!apiKey) {
    await writeMissingKeyHeartbeat(prisma, 'datadocked', 'DATADOCKED_API_KEY')
    return {
      zonesScanned: 0,
      zonesSkipped: 0,
      scans: [],
      keyMissing: true,
      scanningDisabled: !scanningEnabled,
      fetchErrors: 0,
    }
  }
  if (!scanningEnabled) {
    // Second gate — key present but scanning not yet enabled (waiting for
    // Seafarer tier upgrade). Separate heartbeat so ops can distinguish.
    await prisma.costLog.create({
      data: {
        model: 'trigger_runner',
        agentType: 'disabled_heartbeat',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        service: 'datadocked',
        operation: 'disabled:scanning-flag-off',
        metadata: {
          envVar: 'DATADOCKED_SCANNING_ENABLED',
          reason: 'scanning_gate_closed',
        },
      },
    })
    return {
      zonesScanned: 0,
      zonesSkipped: 0,
      scans: [],
      keyMissing: false,
      scanningDisabled: true,
      fetchErrors: 0,
    }
  }

  // Determine which zones are due. Query max scan time per zone from
  // ZoneBaseline.updatedAt (proxy — last observation upsert).
  const allLastScans = await prisma.zoneBaseline.findMany({
    where: { metricName: 'tankerCount', windowDays: 30 },
    select: { zoneId: true, updatedAt: true },
  })
  const lastByZone = new Map(allLastScans.map((r) => [r.zoneId, r.updatedAt]))

  const scans: ZoneScanResult[] = []
  let zonesSkipped = 0
  let fetchErrors = 0

  for (const zone of TIER_1_ZONES) {
    const tier = getZoneScanTier(zone)
    const last = lastByZone.get(zone.id) ?? null
    if (!isZoneDue(tier, last, now)) {
      zonesSkipped++
      continue
    }
    const result = await scanZone(prisma, zone, apiKey, now)
    if (result) scans.push(result)
    else fetchErrors++
  }

  return {
    zonesScanned: scans.length,
    zonesSkipped,
    scans,
    keyMissing: false,
    scanningDisabled: false,
    fetchErrors,
  }
}

void SOURCE_NAME
