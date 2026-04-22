/**
 * Trigger registry — single source of truth for trigger metadata.
 *
 * Phase 1c.1 registers the 7 event-driven triggers with data paths that
 * work today. Phase 1c.2 adds the remaining 14 (narrative, psychological,
 * continuous ground-truth, meta-extended).
 *
 * Env-var gating: each trigger's `enabled` is resolved at dispatch time
 * from the corresponding env var. Default off for conservative rollout —
 * ops sets e.g. `TRIGGER_T_GT1_ENABLED=true` per environment.
 */

import type { TriggerDefinition } from './types'

export const TRIGGER_DEFINITIONS: Record<string, TriggerDefinition> = Object.freeze({
  // ── Narrative (Phase 1c.2b.1) ──
  'T-N1': {
    id: 'T-N1',
    description: 'Article volume spike — hourly count > mean + 2σ',
    stream: 'narrative',
    requiresBaseline: true,
    baselineConfig: { metricName: 'article_volume_hourly', windowDays: 7 },
    enabledEnvVar: 'TRIGGER_T_N1_ENABLED',
  },
  'T-N2': {
    id: 'T-N2',
    description: 'Cross-outlet amplification — ≥5 distinct outlets in 30min',
    stream: 'narrative',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_N2_ENABLED',
  },
  'T-N3': {
    id: 'T-N3',
    description: 'Wire-quality headline event — pattern match',
    stream: 'narrative',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_N3_ENABLED',
  },
  'T-N4': {
    id: 'T-N4',
    description: 'Sentiment extremity batch — 2h keyword consensus',
    stream: 'narrative',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_N4_ENABLED',
  },

  // ── Psychological (Phase 1c.2b.1) ──
  'T-P1': {
    id: 'T-P1',
    description: 'Cashtag velocity spike — hourly count > mean + 3σ',
    stream: 'psychological',
    requiresBaseline: true,
    baselineConfig: { metricName: 'cashtag_velocity_hourly', windowDays: 14 },
    enabledEnvVar: 'TRIGGER_T_P1_ENABLED',
  },
  'T-P2': {
    id: 'T-P2',
    description: 'Engagement velocity acceleration — 2× prev-hour rate',
    stream: 'psychological',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_P2_ENABLED',
  },
  'T-P3': {
    id: 'T-P3',
    description: 'Cross-platform amplification — T-P1 fires on ≥2 platforms in 2h',
    stream: 'psychological',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_P3_ENABLED',
  },
  'T-P4': {
    id: 'T-P4',
    description: 'Sentiment extremity consensus — 2h social keyword match',
    stream: 'psychological',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_P4_ENABLED',
  },

  // ── Ground-truth (event-driven, Phase 1c.1/1c.2a/1c.2b.1) ──
  'T-GT1': {
    id: 'T-GT1',
    description: 'SEC Form 4 — large insider transaction',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT1_ENABLED',
  },
  'T-GT2': {
    id: 'T-GT2',
    description: 'SEC 13D/G — activist stake disclosed',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT2_ENABLED',
  },
  'T-GT3': {
    id: 'T-GT3',
    description: 'SEC 8-K — material event',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT3_ENABLED',
  },
  'T-GT4': {
    id: 'T-GT4',
    description: 'CFTC COT — managed money net position delta',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT4_ENABLED',
  },
  'T-GT5': {
    id: 'T-GT5',
    description: 'Price move — intraday > category threshold',
    stream: 'ground_truth',
    requiresBaseline: true,
    baselineConfig: { metricName: 'realized_vol_30d', windowDays: 30 },
    enabledEnvVar: 'TRIGGER_T_GT5_ENABLED',
  },
  'T-GT6': {
    id: 'T-GT6',
    description: 'Price gap — overnight > category threshold',
    stream: 'ground_truth',
    requiresBaseline: true,
    baselineConfig: { metricName: 'realized_vol_30d', windowDays: 30 },
    enabledEnvVar: 'TRIGGER_T_GT6_ENABLED',
  },
  'T-GT7': {
    id: 'T-GT7',
    description: 'Maritime AIS anomaly — Tier-1 zone vessel-count z-score',
    stream: 'ground_truth',
    requiresBaseline: true,
    baselineConfig: { metricName: 'tankerCount', windowDays: 30 },
    enabledEnvVar: 'TRIGGER_T_GT7_ENABLED',
  },
  'T-GT8': {
    id: 'T-GT8',
    description: 'Commodity inventory release — EIA/USDA surprise z-score',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT8_ENABLED',
  },
  'T-GT9': {
    id: 'T-GT9',
    description: 'Macro surprise — actual vs consensus z-score',
    stream: 'ground_truth',
    requiresBaseline: false, // uses historicalStddev from MacroIndicatorConfig, not entity baseline
    enabledEnvVar: 'TRIGGER_T_GT9_ENABLED',
  },
  'T-GT10': {
    id: 'T-GT10',
    description: 'Congressional trade disclosure',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT10_ENABLED',
  },
  'T-GT11': {
    id: 'T-GT11',
    description: 'Earnings transcript availability',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT11_ENABLED',
  },
  'T-GT12': {
    id: 'T-GT12',
    description: 'Unusual options flow — volume vs open interest',
    stream: 'ground_truth',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_GT12_ENABLED',
  },

  // ── Meta (derived from TriggerEvent table, Phase 1c.1) ──
  'T-META1': {
    id: 'T-META1',
    description: 'Multi-stream confluence — ≥2 streams fired on same entity within 2h',
    stream: 'meta',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_META1_ENABLED',
  },
  'T-META2': {
    id: 'T-META2',
    description: 'Featured-set baseline scan — scheduled rescan of 15 featured entities',
    stream: 'meta',
    requiresBaseline: false,
    enabledEnvVar: 'TRIGGER_T_META2_ENABLED',
  },
})

/**
 * Returns true when the given trigger is enabled per env var.
 * Defaults to TRUE in development if env var is unset; defaults to FALSE
 * in production for conservative rollout.
 */
export function isTriggerEnabled(
  id: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const def = TRIGGER_DEFINITIONS[id]
  if (!def) return false
  const value = env[def.enabledEnvVar]
  if (value === undefined) {
    // Conservative default: only dev enables without explicit setting.
    return env.NODE_ENV !== 'production'
  }
  return value.trim().toLowerCase() === 'true' || value === '1'
}

export const ALL_TRIGGER_IDS: readonly string[] = Object.freeze(Object.keys(TRIGGER_DEFINITIONS))
