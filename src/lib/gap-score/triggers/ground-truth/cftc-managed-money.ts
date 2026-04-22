/**
 * T-GT4 — CFTC managed-money net position delta.
 *
 * Fetches latest COT report, upserts CftcPosition rows, then scans the
 * two most-recent reports per market for week-over-week delta in managed
 * money net %. Fires when |Δ| > 0.10 (10 percentage points).
 *
 * Severity log-scaled: 10% → 0.4, 25% → 0.8, 50%+ → 1.0.
 * Direction: net long increase → +1, net short increase → -1.
 *
 * Schedule: every 6h via candidate-generator-worker repeatable. The
 * release lands Friday ~15:30 ET; 6h cadence means we catch it within
 * a few hours without polling busy-wait. Dedup on TriggerEvent per
 * (entity, reportDate) means re-scans don't re-fire.
 *
 * Unmapped CFTC markets (not in cftc-entity-resolver.ts) → CostLog
 * operation='cftc-unmapped-market' for audit + registry expansion.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import {
  fetchLatestCotReport,
  upsertCotRows,
  type CotRow,
} from '@/lib/raw-signals/integrations/cftc-cot'
import { resolveCftcCode } from './cftc-entity-resolver'

const TRIGGER_ID = 'T-GT4'
const DELTA_FLOOR = 0.10 // 10 percentage-point absolute delta
const SEVERITY_ANCHORS = [
  { delta: 0.10, severity: 0.4 },
  { delta: 0.25, severity: 0.8 },
  { delta: 0.50, severity: 1.0 },
]

function computeSeverity(absDelta: number): number {
  if (absDelta <= 0) return 0
  // Interpolate across the anchors
  for (let i = 0; i < SEVERITY_ANCHORS.length - 1; i++) {
    const a = SEVERITY_ANCHORS[i]
    const b = SEVERITY_ANCHORS[i + 1]
    if (absDelta >= a.delta && absDelta <= b.delta) {
      const frac = (absDelta - a.delta) / (b.delta - a.delta)
      return a.severity + frac * (b.severity - a.severity)
    }
  }
  // Above the top anchor
  return 1.0
}

export async function cftcManagedMoneyTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  // 1. Fetch latest report + upsert
  const rows = await fetchLatestCotReport()
  if (rows.length === 0) {
    // Heartbeat — keeps T-GT4 dormant state visible
    await ctx.prisma.costLog.create({
      data: {
        model: 'trigger_runner',
        agentType: 'trigger_scrape_heartbeat',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        service: 'trigger',
        operation: 'cftc-scrape-heartbeat',
        metadata: { triggerId: TRIGGER_ID, outcome: 'no_data' },
      },
    })
    return []
  }
  await upsertCotRows(ctx.prisma, rows)

  // 2. For each distinct (marketCode, exchangeCode) in the freshly-landed
  //    report, fetch the two most recent reports and compute the delta.
  const distinctMarkets = new Map<string, { code: string; exchange: string }>()
  for (const r of rows) {
    const key = `${r.marketCode}|${r.exchangeCode}`
    if (!distinctMarkets.has(key)) {
      distinctMarkets.set(key, { code: r.marketCode, exchange: r.exchangeCode })
    }
  }

  const unmappedCodes: string[] = []
  const fires: TriggerFireEvent[] = []

  for (const { code, exchange } of distinctMarkets.values()) {
    const mapping = resolveCftcCode(code)
    if (!mapping) {
      unmappedCodes.push(code)
      continue
    }
    // Resolve entity ID
    const entity = await ctx.prisma.trackedEntity.findUnique({
      where: { identifier: mapping.trackedEntityIdentifier },
      select: { id: true },
    })
    if (!entity) {
      unmappedCodes.push(code)
      continue
    }

    // Two most-recent reports for this market
    const recent = await ctx.prisma.cftcPosition.findMany({
      where: { marketCode: code, exchangeCode: exchange },
      orderBy: { reportDate: 'desc' },
      take: 2,
    })
    if (recent.length < 2) continue // no prior week — nothing to delta against
    const current = recent[0]
    const prior = recent[1]

    // Dedupe: has T-GT4 already fired for (entity, current.reportDate)?
    const existing = await ctx.prisma.triggerEvent.findFirst({
      where: {
        entityId: entity.id,
        triggerType: TRIGGER_ID,
        firedAt: { gte: current.reportDate },
      },
      select: { id: true },
    })
    if (existing) continue

    const delta = current.managedMoneyNetPct - prior.managedMoneyNetPct
    const absDelta = Math.abs(delta)
    if (absDelta < DELTA_FLOOR) continue

    const severity = computeSeverity(absDelta)
    const direction = delta > 0 ? 1 : -1

    fires.push({
      entityId: entity.id,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity,
      metadata: {
        market_code: code,
        exchange_code: exchange,
        market_label: mapping.label,
        report_date: current.reportDate.toISOString(),
        prior_report_date: prior.reportDate.toISOString(),
        managed_money_net_pct_current: current.managedMoneyNetPct,
        managed_money_net_pct_prior: prior.managedMoneyNetPct,
        delta,
        direction,
      },
    })
  }

  // Log unmapped markets for registry expansion
  if (unmappedCodes.length > 0) {
    const uniq = Array.from(new Set(unmappedCodes))
    await ctx.prisma.costLog.createMany({
      data: uniq.map((code) => ({
        model: 'trigger_runner',
        agentType: 'trigger_unmatched_filing',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        service: 'trigger',
        operation: 'cftc-unmapped-market',
        metadata: { triggerId: TRIGGER_ID, cftcCode: code },
      })),
    })
  }

  // Success heartbeat
  await ctx.prisma.costLog.create({
    data: {
      model: 'trigger_runner',
      agentType: 'trigger_scrape_heartbeat',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: 'trigger',
      operation: 'cftc-scrape-heartbeat',
      metadata: {
        triggerId: TRIGGER_ID,
        outcome: 'success',
        rows_upserted: rows.length,
        markets_evaluated: distinctMarkets.size,
        unmapped_count: unmappedCodes.length,
        fires: fires.length,
      },
    },
  })

  return fires
}

export { computeSeverity as cftcSeverityFromDelta }
