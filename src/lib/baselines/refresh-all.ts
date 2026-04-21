/**
 * Top-level baseline refresh orchestrator.
 *
 * Kicks both entity and zone refreshers in sequence, aggregates results,
 * logs a CostLog row (service='baseline_refresh', cost=0). Designed to be
 * called from:
 *   - POST /api/admin/baselines/refresh (manual admin trigger)
 *   - A future daily cron (Phase 1c scheduler)
 *
 * Sequential, not parallel: Prisma connection pool is finite and baseline
 * upserts can be chatty. Sequential execution keeps the pool happy on
 * small Supabase plans.
 */

import type { PrismaClient } from '@prisma/client'
import {
  refreshEntityBaselines,
  type RefreshEntityBaselinesResult,
} from './entity-baseline-refresh'
import {
  refreshZoneBaselines,
  type RefreshZoneBaselinesResult,
} from './zone-baseline-refresh'

export interface RefreshAllResult {
  entity: RefreshEntityBaselinesResult
  zone: RefreshZoneBaselinesResult
  durationMs: number
  startedAt: string
  finishedAt: string
}

export async function refreshAllBaselines(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<RefreshAllResult> {
  const startedAt = now.toISOString()
  const start = Date.now()

  const entity = await refreshEntityBaselines(prisma, now)
  const zone = await refreshZoneBaselines(prisma, now)

  const finishedAt = new Date().toISOString()
  const durationMs = Date.now() - start

  // Write a cost-log marker row. cost=0 because no LLM/API calls fired.
  // Useful for observing refresher cadence in the cost dashboard later.
  try {
    await prisma.costLog.create({
      data: {
        model: 'baseline_refresh',
        agentType: 'baseline_refresh',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        service: 'baseline_refresh',
        operation: 'refresh_all',
        metadata: {
          durationMs,
          entityRowsWritten: entity.rowsWritten,
          zoneRowsWritten: zone.rowsWritten,
          entityMatureCount: entity.matureCount,
          zoneMatureCount: zone.matureCount,
          errorCount: entity.errors.length + zone.errors.length,
        },
      },
    })
  } catch {
    // Cost logging is nice-to-have, not load-bearing. Swallow errors
    // here — the refresh itself already succeeded.
  }

  return { entity, zone, durationMs, startedAt, finishedAt }
}
