/**
 * Pipeline cost-optimization flags — single source of truth for which stage
 * skips are active for any given analysis. Designed so call sites depend only
 * on the resolved typed shape; the underlying configuration source (env vars
 * today, PipelineFlagConfig table tomorrow) can change without touching them.
 *
 * Spec: docs/plans/2026-04-19-cost-optimization-layer.md
 *
 * Five flags + one override. All flags default ON. The override
 * (PIPELINE_FORCE_FULL_QUALITY) bypasses all five — used for enterprise demos,
 * flagship arc analyses, and anything bound for the public accuracy tracker.
 *
 * Two non-negotiables enforced by assertNonNegotiables():
 *   1. Tier-1 sources (wire_service, national) never lose model count.
 *   2. Cross-examination rounds never skip on contested claims.
 *
 * Resolution order (highest precedence first):
 *   1. opts.forceFullQuality === true (CLI / queue per-run arg)
 *   2. process.env.PIPELINE_FORCE_FULL_QUALITY === '1' (global env default)
 *   3. process.env.PIPELINE_<FLAG_NAME> ('0' to disable, anything else enables)
 */

export type PipelineFlagName =
  | 'tiered_source_processing'
  | 'arc_rerun_differential'
  | 'semantic_dedup'
  | 'confidence_threshold_exit'
  | 'regional_debate_pooling'

export const ALL_FLAGS: readonly PipelineFlagName[] = Object.freeze([
  'tiered_source_processing',
  'arc_rerun_differential',
  'semantic_dedup',
  'confidence_threshold_exit',
  'regional_debate_pooling',
])

export interface PipelineFlags {
  tiered_source_processing: boolean
  arc_rerun_differential: boolean
  semantic_dedup: boolean
  confidence_threshold_exit: boolean
  regional_debate_pooling: boolean
  /** True when PIPELINE_FORCE_FULL_QUALITY caused all five flags to resolve off. */
  forceFullQualityActive: boolean
  /** Subset of ALL_FLAGS whose resolved value is true. Convenience for telemetry. */
  flagsActive: PipelineFlagName[]
  /** Subset of ALL_FLAGS whose resolved value is false. Convenience for telemetry. */
  flagsForcedOff: PipelineFlagName[]
}

export interface ResolveFlagsOptions {
  /** Per-run override; CLI/queue can flip to true even when env default is off. */
  forceFullQuality?: boolean
  /**
   * Optional explicit env override map for tests. When omitted, reads from
   * process.env. Keys must match the env var names exactly
   * (e.g. 'PIPELINE_FORCE_FULL_QUALITY', 'PIPELINE_TIERED_SOURCE_PROCESSING').
   */
  env?: Record<string, string | undefined>
}

const FLAG_TO_ENV_VAR: Record<PipelineFlagName, string> = {
  tiered_source_processing: 'PIPELINE_TIERED_SOURCE_PROCESSING',
  arc_rerun_differential: 'PIPELINE_ARC_RERUN_DIFFERENTIAL',
  semantic_dedup: 'PIPELINE_SEMANTIC_DEDUP',
  confidence_threshold_exit: 'PIPELINE_CONFIDENCE_THRESHOLD_EXIT',
  regional_debate_pooling: 'PIPELINE_REGIONAL_DEBATE_POOLING',
}

function envToBool(value: string | undefined, defaultWhenUnset: boolean): boolean {
  if (value === undefined) return defaultWhenUnset
  // Treat '0', 'false', 'off', 'no' (case-insensitive, trimmed) as disabled.
  // Everything else — including empty string — is enabled. Empty string
  // matters because some shells (Windows in particular) export empty values
  // for unset vars; we default such vars to enabled, consistent with "default on".
  const normalized = value.trim().toLowerCase()
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false
  return true
}

/**
 * Resolve the pipeline flag set for a single analysis.
 *
 * Pure function: same inputs always produce the same output. No side effects.
 * Logging happens at the call site, not here, so tests can assert on the
 * returned shape without intercepting console.
 */
export function resolveFlags(opts: ResolveFlagsOptions = {}): PipelineFlags {
  const env = opts.env ?? process.env

  // Force-full-quality precedence: per-call arg > env var.
  const envForce = envToBool(env.PIPELINE_FORCE_FULL_QUALITY, false)
  const forceFullQuality = opts.forceFullQuality === true || envForce

  if (forceFullQuality) {
    // All five flags forced off. flagsActive empty; flagsForcedOff = all.
    return {
      tiered_source_processing: false,
      arc_rerun_differential: false,
      semantic_dedup: false,
      confidence_threshold_exit: false,
      regional_debate_pooling: false,
      forceFullQualityActive: true,
      flagsActive: [],
      flagsForcedOff: [...ALL_FLAGS],
    }
  }

  const resolved: Record<PipelineFlagName, boolean> = {
    tiered_source_processing: envToBool(env[FLAG_TO_ENV_VAR.tiered_source_processing], true),
    arc_rerun_differential: envToBool(env[FLAG_TO_ENV_VAR.arc_rerun_differential], true),
    semantic_dedup: envToBool(env[FLAG_TO_ENV_VAR.semantic_dedup], true),
    confidence_threshold_exit: envToBool(env[FLAG_TO_ENV_VAR.confidence_threshold_exit], true),
    regional_debate_pooling: envToBool(env[FLAG_TO_ENV_VAR.regional_debate_pooling], true),
  }

  const flagsActive: PipelineFlagName[] = []
  const flagsForcedOff: PipelineFlagName[] = []
  for (const name of ALL_FLAGS) {
    if (resolved[name]) flagsActive.push(name)
    else flagsForcedOff.push(name)
  }

  return {
    ...resolved,
    forceFullQualityActive: false,
    flagsActive,
    flagsForcedOff,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Non-negotiable assertions — invoked at the call sites that act on flags
// to guarantee the two invariants are never violated regardless of how the
// flag combination resolves.
// ─────────────────────────────────────────────────────────────────────────

// Specialty promoted to Tier 1 on 2026-04-19 after Flag 1 review.
// Lloyd's List, S&P Global, Argus Media etc. carry the editorial signal for
// clusters like Hormuz; demoting them silently inverts the finding.
const TIER_1_TIERS: readonly string[] = ['wire_service', 'national', 'specialty']

/**
 * The three pipeline paths a source can take after Flag 1 classification.
 *  - full_debate: 4 analysts \u00d7 3 rounds (R1, R2 cross-exam, R3 moderator).
 *  - two_model_debate: Anthropic + xAI only (cheaper subset). Skips Gemini + GPT.
 *  - haiku_summary: single Haiku call producing a short context block. No debate.
 */
export type DebatePath = 'full_debate' | 'two_model_debate' | 'haiku_summary'

/**
 * Tier \u2192 path mapping under Flag 1 (tiered_source_processing) when active.
 * Specialty is mapped to full_debate per the Hormuz cluster Standing Editorial
 * Note (Lloyd's List, S&P Global, Argus Media — specialist press is the
 * primary editorial signal for that cluster). Specialty is NOT in TIER_1_TIERS,
 * so the non-negotiable assertion does not protect it; future flags may
 * legitimately demote it. Wire_service + national are protected.
 */
export const TIER_TO_PATH: Readonly<Record<string, DebatePath>> = Object.freeze({
  wire_service: 'full_debate',
  national: 'full_debate',
  specialty: 'full_debate',
  regional: 'two_model_debate',
  emerging: 'haiku_summary',
  unclassified: 'haiku_summary',
})

export interface TieredSource {
  /** From Outlet.tier — 'wire_service' | 'national' | 'regional' | 'specialty' | 'emerging' | 'unclassified'. */
  tier: string
  /** Pipeline path the flag layer is about to assign this source to. */
  assignedPath: DebatePath
}

/**
 * Pure tier-string-in / path-out classifier. No DB, no I/O.
 *   - When flag is OFF: every tier maps to full_debate (no skips).
 *   - When flag is ON: TIER_TO_PATH applied; unknown tiers default to
 *     haiku_summary (most conservative — no debate spend on unknown outlets).
 */
export function assignSourcePath(tier: string, flagActive: boolean): DebatePath {
  if (!flagActive) return 'full_debate'
  return TIER_TO_PATH[tier] ?? 'haiku_summary'
}

/**
 * A source-shaped input to the tier classifier. Caller is responsible for
 * looking up Outlet.tier and attaching it to each source (via
 * lookupSourceTiers below or equivalent) before calling this. We accept a
 * minimal shape so the function stays testable without the full TriagedSource
 * type or the Outlet table.
 */
export interface SourceForTierAssignment {
  url: string
  outlet: string
  tier: string
}

/**
 * Classify a list of sources by their tier under Flag 1, attaching the
 * assigned path to each. Fires assertTier1FullDebate for every classified
 * source so any future refactor that misclassifies a tier-1 source crashes
 * loudly rather than silently degrading flagship coverage. Pure function;
 * no I/O.
 *
 * Acts on flags.tiered_source_processing — when off (or when force-full is
 * active, which forces all flags off), every source gets full_debate.
 */
export function assignSourcesByTier<T extends SourceForTierAssignment>(
  sources: readonly T[],
  flags: PipelineFlags,
): Array<T & { assignedPath: DebatePath }> {
  const flagActive = flags.tiered_source_processing
  const result: Array<T & { assignedPath: DebatePath }> = []
  for (const source of sources) {
    const assignedPath = assignSourcePath(source.tier, flagActive)
    assertTier1FullDebate({ tier: source.tier, assignedPath }, 'tiered_source_processing')
    result.push({ ...source, assignedPath })
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────
// Tier lookup — batch-fetches Outlet.tier for the domains in a source set.
// Dependency-injection design (TierFetcher arg) keeps unit tests pure; the
// default fetcher uses Prisma and is the only impure code path in this module.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fetcher signature. Implementations take a deduplicated list of normalized
 * domains (no www., lowercase, no protocol) and return a partial map of
 * domain → tier. Domains absent from the returned map default to 'unclassified'
 * downstream — the fetcher does not need to populate misses explicitly.
 */
export type TierFetcher = (domains: string[]) => Promise<Record<string, string>>

/**
 * Default fetcher — batch-queries the Outlet table for the given domains.
 * Lazy-imports prisma so the module stays unit-testable without forcing
 * Prisma into every test process.
 */
async function defaultTierFetcher(domains: string[]): Promise<Record<string, string>> {
  if (domains.length === 0) return {}
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.outlet.findMany({
    where: { domain: { in: domains } },
    select: { domain: true, tier: true },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.domain] = r.tier
  return map
}

/** Normalize a URL's host the same way the Outlet table stores it: lowercase, www. stripped. */
function normalizeHost(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * Look up the Outlet.tier for each source by URL hostname. Returns a
 * url → tier map. Sources whose host can't be parsed, or whose host has
 * no Outlet record, default to 'unclassified' (which routes to haiku_summary
 * under Flag 1 — most conservative cost behavior on unknown outlets).
 *
 * One DB query per call regardless of source count: domains are deduplicated
 * before fetching. Tests inject a stub fetcher to avoid DB I/O.
 */
export async function lookupSourceTiers(
  sources: ReadonlyArray<{ url: string }>,
  fetcher: TierFetcher = defaultTierFetcher,
): Promise<Record<string, string>> {
  if (sources.length === 0) return {}

  // Map url → normalized domain (or null for malformed URLs)
  const urlToDomain = new Map<string, string | null>()
  const uniqueDomains = new Set<string>()
  for (const s of sources) {
    const host = normalizeHost(s.url)
    urlToDomain.set(s.url, host)
    if (host) uniqueDomains.add(host)
  }

  const domainTiers = uniqueDomains.size > 0
    ? await fetcher(Array.from(uniqueDomains))
    : {}

  const result: Record<string, string> = {}
  for (const s of sources) {
    const host = urlToDomain.get(s.url)
    if (host && domainTiers[host]) {
      result[s.url] = domainTiers[host]
    } else {
      result[s.url] = 'unclassified'
    }
  }
  return result
}

/**
 * Non-negotiable #1: tier-1 sources (wire_service + national) must never
 * lose model count under any flag combination. Throws when violated so the
 * pipeline fails fast rather than silently degrading flagship coverage.
 */
export function assertTier1FullDebate(
  source: TieredSource,
  flagThatAssigned: PipelineFlagName | 'unknown',
): void {
  if (TIER_1_TIERS.includes(source.tier) && source.assignedPath !== 'full_debate') {
    throw new Error(
      `[pipeline-flags] NON-NEGOTIABLE VIOLATION: tier-1 source (tier='${source.tier}') ` +
        `was assigned path='${source.assignedPath}' by flag='${flagThatAssigned}'. ` +
        `Tier-1 sources (${TIER_1_TIERS.join(', ')}) must always receive full_debate. ` +
        `Fix the flag's source assignment logic.`,
    )
  }
}

export interface ContestedClaimDecision {
  /** Stable identifier for the claim (e.g. claim text hash or sortOrder). */
  claimId: string
  /** True when at least one R1 model raised a substantive contradiction. */
  isContested: boolean
  /** True when flag 4's exit logic has chosen to skip R2/R3 for this claim. */
  willSkipCrossExam: boolean
}

/**
 * Non-negotiable #2: contested claims must always run cross-examination
 * (R2 + R3). Flag 4's early exit may only skip cross-exam on consensus
 * claims (≥85% agreement, no substantive dissent). Throws when flag 4
 * tries to skip a contested claim.
 */
export function assertContestedClaimDebated(decision: ContestedClaimDecision): void {
  if (decision.isContested && decision.willSkipCrossExam) {
    throw new Error(
      `[pipeline-flags] NON-NEGOTIABLE VIOLATION: claim '${decision.claimId}' is contested ` +
        `(at least one R1 model raised a substantive contradiction) but flag ` +
        `'confidence_threshold_exit' attempted to skip cross-examination. ` +
        `Contested claims must always run R2 + R3. Fix the consensus calculation.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Telemetry helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format the one-line warning emitted when PIPELINE_FORCE_FULL_QUALITY is active.
 * Pure function so tests can assert on the exact string.
 */
export function formatForceFullQualityWarning(): string {
  return (
    '[pipeline-flags] PIPELINE_FORCE_FULL_QUALITY active — all 5 cost-optimization flags ' +
    'bypassed. This run will cost ~2-5x baseline. Use only for flagship analyses, ' +
    'enterprise demos, or anything bound for the public accuracy tracker.'
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Summary writer — one CostLog row per analysis with the flag-by-flag
// savings breakdown. Foundation version writes placeholder zeros for
// per-flag savings; each subsequent flag turn populates its own contribution
// once that flag actually gates a stage skip. Shape documented in
// docs/plans/2026-04-19-cost-optimization-layer.md.
// ─────────────────────────────────────────────────────────────────────────

export interface FlagBreakdown {
  estimatedFullCostUsd: number
  actualCostUsd: number
  savingsUsd: number
  savingsPct: number
  flagsActive: PipelineFlagName[]
  flagsForcedOff: PipelineFlagName[]
  perFlagSavings: Partial<Record<PipelineFlagName, number>>
  sourcesFiltered: {
    below_uniqueness: number
    regional_pool_overflow: number
    tier_haiku_only: number
    tier_two_model_only: number
    arc_rerun_continuing: number
  }
  forceFullQualityActive: boolean
}

export interface PipelineSavingsSummaryInput {
  storyId: string | null
  flags: PipelineFlags
  /** Sum of per-call costUsd for this analysis as run. */
  actualCostUsd: number
  /** Estimated cost if PIPELINE_FORCE_FULL_QUALITY had been on (no flag skips). */
  estimatedFullCostUsd: number
  /** Per-flag savings contribution. Keys absent default to 0. */
  perFlagSavings?: Partial<Record<PipelineFlagName, number>>
  /** Source counts filtered by each flag's behavior. Defaults to all 0. */
  sourcesFiltered?: Partial<{
    below_uniqueness: number
    regional_pool_overflow: number
    tier_haiku_only: number
    tier_two_model_only: number
    arc_rerun_continuing: number
  }>
}

export function buildFlagBreakdown(input: PipelineSavingsSummaryInput): FlagBreakdown {
  const savingsUsd = Math.max(0, input.estimatedFullCostUsd - input.actualCostUsd)
  const savingsPct =
    input.estimatedFullCostUsd > 0
      ? (savingsUsd / input.estimatedFullCostUsd) * 100
      : 0
  return {
    estimatedFullCostUsd: input.estimatedFullCostUsd,
    actualCostUsd: input.actualCostUsd,
    savingsUsd,
    savingsPct: Math.round(savingsPct * 10) / 10,
    flagsActive: input.flags.flagsActive,
    flagsForcedOff: input.flags.flagsForcedOff,
    perFlagSavings: input.perFlagSavings ?? {},
    sourcesFiltered: {
      below_uniqueness: input.sourcesFiltered?.below_uniqueness ?? 0,
      regional_pool_overflow: input.sourcesFiltered?.regional_pool_overflow ?? 0,
      tier_haiku_only: input.sourcesFiltered?.tier_haiku_only ?? 0,
      tier_two_model_only: input.sourcesFiltered?.tier_two_model_only ?? 0,
      arc_rerun_continuing: input.sourcesFiltered?.arc_rerun_continuing ?? 0,
    },
    forceFullQualityActive: input.flags.forceFullQualityActive,
  }
}

/**
 * Write the one summary CostLog row for an analysis. agentType='pipeline_savings'
 * is the marker — per-call rows use other agentType values. This row's costUsd
 * is set to actualCostUsd so dashboards can sum costUsd across both per-call
 * and summary rows without double-counting (per-call rows themselves sum to
 * actualCostUsd, so adding the summary's costUsd overcounts unless filtered).
 *
 * To avoid double-counting at the storyId level, dashboards should either:
 *   (a) sum costUsd where agentType != 'pipeline_savings' (true cost), OR
 *   (b) read flagBreakdown.actualCostUsd from the single summary row (also true cost).
 *
 * The summary-row costUsd field is informational only — its real signal is in
 * flagBreakdown JSON. We set costUsd=0 on the summary row to make filter (a)
 * the natural default and prevent accidental double-counting.
 */
export async function writePipelineSavingsSummary(
  input: PipelineSavingsSummaryInput,
): Promise<{ id: string; flagBreakdown: FlagBreakdown }> {
  // Lazy-import prisma so this module stays a pure dep of pipeline.ts without
  // forcing every test that imports the resolver to also load Prisma.
  const { prisma } = await import('@/lib/db')
  const breakdown = buildFlagBreakdown(input)
  const row = await prisma.costLog.create({
    data: {
      storyId: input.storyId,
      model: 'pipeline-savings',
      agentType: 'pipeline_savings',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      flagBreakdown: breakdown as unknown as object,
      forceFullQualityActive: input.flags.forceFullQualityActive,
    },
    select: { id: true },
  })
  return { id: row.id, flagBreakdown: breakdown }
}
