/**
 * T-GT12 — unusual options flow.
 *
 * For each featured-set entity, fetches the options chain snapshot from
 * Polygon (Developer tier + options real-time add-on required for the
 * OPRA feed). Identifies contracts with unusual volume: dayVolume /
 * openInterest > UNUSUAL_VOLUME_RATIO. Aggregates per underlying and
 * fires one TriggerEvent per entity with the dominant direction from
 * the most-unusual contract (call-dominant → +1, put-dominant → -1).
 *
 * Severity scales with the max volume/OI ratio observed:
 *   2x → 0.4
 *   5x → 0.8
 *   10x+ → 1.0
 *
 * Rate-limit sensitive: Polygon Developer supports 1000 req/min on the
 * options snapshot endpoint. Featured set of ~30 equities × every-30min
 * cadence = 1440/day → ~60/hr peak. Well within tier.
 *
 * Dedup: once-per-entity-per-day, same pattern as T-GT5/6.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { fetchOptionsChain } from '@/lib/raw-signals/clients/polygon-client'
import { writeMissingKeyHeartbeat } from '@/lib/gap-score/missing-key-heartbeat'

const TRIGGER_ID = 'T-GT12'
const UNUSUAL_VOLUME_RATIO_FLOOR = 2.0
const MIN_CONTRACT_VOLUME = 500
const MIN_CONTRACT_OPEN_INTEREST = 50

const SEVERITY_ANCHORS = [
  { ratio: 2, severity: 0.4 },
  { ratio: 5, severity: 0.8 },
  { ratio: 10, severity: 1.0 },
]

export function optionsFlowSeverity(maxRatio: number): number {
  if (maxRatio < UNUSUAL_VOLUME_RATIO_FLOOR) return 0
  for (let i = 0; i < SEVERITY_ANCHORS.length - 1; i++) {
    const a = SEVERITY_ANCHORS[i]
    const b = SEVERITY_ANCHORS[i + 1]
    if (maxRatio >= a.ratio && maxRatio <= b.ratio) {
      const frac = (maxRatio - a.ratio) / (b.ratio - a.ratio)
      return a.severity + frac * (b.severity - a.severity)
    }
  }
  return 1.0
}

export async function optionsFlowUnusualTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    await writeMissingKeyHeartbeat(ctx.prisma, 'polygon', 'POLYGON_API_KEY')
    return []
  }

  const entities = await ctx.prisma.trackedEntity.findMany({
    where: {
      isFeatured: true,
      active: true,
      category: { in: ['equity', 'etf'] },
    },
    select: { id: true, identifier: true, category: true },
  })
  if (entities.length === 0) return []

  const todayStart = new Date(ctx.now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const todaysFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
      firedAt: { gte: todayStart, lte: ctx.now },
    },
    select: { entityId: true },
  })
  const alreadyFired = new Set(todaysFires.map((f) => f.entityId))

  const fires: TriggerFireEvent[] = []

  for (const entity of entities) {
    if (alreadyFired.has(entity.id)) continue

    const outcome = await fetchOptionsChain(entity.identifier, apiKey)
    if (!outcome.ok) continue

    const unusual = outcome.value.filter(
      (c) =>
        c.dayVolume >= MIN_CONTRACT_VOLUME &&
        c.openInterest >= MIN_CONTRACT_OPEN_INTEREST &&
        c.dayVolume / c.openInterest >= UNUSUAL_VOLUME_RATIO_FLOOR,
    )
    if (unusual.length === 0) continue

    // Dominant contract = highest volume/OI ratio
    const dominant = unusual.reduce((best, cur) =>
      cur.dayVolume / cur.openInterest > best.dayVolume / best.openInterest ? cur : best,
    )
    const dominantRatio = dominant.dayVolume / dominant.openInterest

    // Direction: aggregate call vs put volume
    const callVolume = unusual.filter((c) => c.type === 'call').reduce((a, c) => a + c.dayVolume, 0)
    const putVolume = unusual.filter((c) => c.type === 'put').reduce((a, c) => a + c.dayVolume, 0)
    const direction = callVolume > putVolume ? 1 : putVolume > callVolume ? -1 : 0

    const severity = optionsFlowSeverity(dominantRatio)
    if (severity <= 0) continue

    fires.push({
      entityId: entity.id,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity,
      metadata: {
        identifier: entity.identifier,
        unusual_contract_count: unusual.length,
        dominant_contract: dominant.contract,
        dominant_ratio: dominantRatio,
        dominant_type: dominant.type,
        dominant_strike: dominant.strike,
        dominant_expiration: dominant.expiration,
        call_volume: callVolume,
        put_volume: putVolume,
        direction,
      },
    })
  }

  return fires
}
