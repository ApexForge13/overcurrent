/**
 * Trigger framework types — Phase 1 addendum A1.1 + A1.2-4.
 *
 * Every trigger emits a `TriggerFireEvent` on fire. The dispatcher writes
 * these to the `TriggerEvent` table. The candidate generator reads them
 * later to decide which entities to rescore.
 *
 * Streams:
 *   - narrative:      news / article volume / headline events
 *   - psychological:  social signals (Reddit/Twitter/Telegram)
 *   - ground_truth:   SEC filings, CFTC, price moves, maritime, macro
 *   - meta:           derived from other TriggerEvents (confluence scans)
 *
 * Direction convention:
 *   +1 = bullish for the entity
 *   -1 = bearish
 *    0 = direction ambiguous (high-severity alert without direction)
 * Direction is encoded in metadata per trigger, not as a required field —
 * different triggers have different direction-mapping conventions and some
 * (like chokepoint anomalies) explicitly don't assign direction.
 */

import type { PrismaClient } from '@prisma/client'

export type TriggerStream = 'narrative' | 'psychological' | 'ground_truth' | 'meta'

export interface TriggerDefinition {
  /** Stable ID (e.g., "T-GT1"). Matches the Phase 1 addendum nomenclature. */
  id: string
  /** Human-readable description for admin UI. */
  description: string
  stream: TriggerStream
  /**
   * True when the trigger needs baseline maturity before firing. Maturity
   * gate checks EntityBaseline/ZoneBaseline.isMature before invoking.
   */
  requiresBaseline: boolean
  baselineConfig?: {
    metricName: string
    windowDays: number
  }
  /** Env-var controlled for Phase 1c.1; DB-backed in 1c.2 alongside admin UI. */
  enabledEnvVar: string
}

export interface TriggerFireEvent {
  entityId: string
  triggerType: string // matches TriggerDefinition.id
  stream: TriggerStream
  severity: number // 0.0 — 1.0
  metadata: Record<string, unknown>
}

export interface TriggerContext {
  prisma: PrismaClient
  now: Date
  /** True when the trigger is allowed to make external API calls. */
  allowExternalFetch?: boolean
}

/** Each trigger is a function that inspects data and returns fires. */
export type TriggerFunction = (ctx: TriggerContext) => Promise<TriggerFireEvent[]>
