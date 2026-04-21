/**
 * Product-layer feature flags.
 *
 * Distinct from src/lib/pipeline-flags.ts, which controls cost-optimization
 * behavior inside a single debate-pipeline run. THIS module controls which
 * product surfaces are reachable at all — during the v2 pivot, legacy surfaces
 * (debate pipeline, story pages, propagation map, discourse layer, social
 * automation) are hidden behind FEATURE_* env vars that default off. New
 * product surfaces (Gap Score, trigger-driven scanning) default on.
 *
 * Resolution:
 *   - Legacy flags: FEATURE_X === 'true' to enable. Any other value (including
 *     unset, empty, '0', 'false', etc.) → disabled. Conservative default: off.
 *   - New-product flags: FEATURE_X !== 'false' to enable. Only the literal
 *     string 'false' disables. Conservative default: on.
 *   - Neural hero: same as new-product — on unless explicitly 'false'.
 *
 * No runtime mutation, no async lookup. Read at module load; stable for the
 * lifetime of the process. Redeploy to change.
 *
 * Call sites use `if (!featureFlags.X) { ... }` directly. A shared helper was
 * considered for Phase 0 and deferred — the three enforcement patterns
 * (orchestrator throw, RSC notFound(), API 404 Response) have incompatible
 * return types and would obscure more than they save. Revisit after Phase 0
 * gates have been in place long enough to validate patterns.
 */

export const featureFlags = {
  // ── Legacy surfaces (default OFF — require explicit FEATURE_*=true) ──
  DEBATE_PIPELINE_ENABLED: process.env.FEATURE_DEBATE_PIPELINE === 'true',
  LEGACY_STORY_PAGES_ENABLED: process.env.FEATURE_LEGACY_STORIES === 'true',
  PROPAGATION_MAP_ENABLED: process.env.FEATURE_PROPAGATION_MAP === 'true',
  DISCOURSE_LAYER_ENABLED: process.env.FEATURE_DISCOURSE === 'true',
  SOCIAL_AUTOMATION_ENABLED: process.env.FEATURE_SOCIAL_AUTO === 'true',

  // ── Retained / new-product surfaces (default ON — require 'false' to disable) ──
  NEURAL_NETWORK_HERO_ENABLED: process.env.FEATURE_NEURAL_HERO !== 'false',
  GAP_SCORE_ENABLED: process.env.FEATURE_GAP_SCORE !== 'false',
  TRIGGER_DRIVEN_SCANNING: process.env.FEATURE_TRIGGER_SCAN !== 'false',
} as const

export type FeatureFlagName = keyof typeof featureFlags
