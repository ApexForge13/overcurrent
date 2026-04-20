# 2026-04-19 — Cost Optimization Layer

## Why

The 4-model × 3-round debate is the dominant cost in `runVerifyPipeline`. Arc reruns re-debate continuing-coverage sources that the prior analysis already produced consensus on. Regional sources from low-tier outlets pull all four models through three rounds even when they add no new claims. Goal: 60–80% cost reduction on arc reruns, 40–60% on new analyses, with no editorial regression on the analyses that matter.

Five flags (default on) gate stage skips. One override (`PIPELINE_FORCE_FULL_QUALITY`) bypasses all five — used for enterprise demos, flagship arc analyses, and anything destined for the public accuracy tracker.

## Non-negotiables (enforced via assertion in the resolver / debate stage)

1. Tier-1 sources (`wire_service`, `national`) **never** lose model count regardless of flag combination.
2. Cross-examination rounds **never** skip on contested claims (only consensus-≥85% claims may exit early under flag 4).

## Five flags

| Flag | Stage gated | Behavior when on | Cost mechanism |
|---|---|---|---|
| `tiered_source_processing` | Pre-debate per-source assignment | wire/national: full 4-model debate. regional: 2-model (Claude + Grok). emerging/unclassified: Haiku summary only. | Cuts model count on lower-tier sources. |
| `arc_rerun_differential` | Post-triage Haiku classifier (arc_rerun only) | Compare each source `publishedAt` to prior analysis `createdAt`. New: full debate. Continuing: Haiku summary. Sample 20% of continuing into debate for stability check. | Skips full debate on already-debated coverage. |
| `semantic_dedup` | Post-triage Haiku scorer | Score each source 0–10 for claim uniqueness vs current pool. Drop sources with score < 4. Target 20–30% removed. | Filters redundant sources before debate entry. |
| `confidence_threshold_exit` | Inside `runRegionalDebate` between R1 and R2 | If consensus ≥85% on a claim (4/4 models or 3/4 with substantive third) skip R2 + R3 for that claim. Continue full rounds on contested claims only. | Skips cross-examination on settled claims. |
| `regional_debate_pooling` | Per-region wrapper around `runRegionalDebate` | Top 8 sources per region by tier rank then `publishedAt` asc then `Source.id` get full debate. Remaining regional sources: Haiku summary. | Caps full-debate input per region. |

## Configuration

**Resolution order** (highest precedence first):
1. Per-call `forceFullQuality: true` argument to `runVerifyPipeline` (CLI `--force-full-quality`).
2. `PIPELINE_FORCE_FULL_QUALITY=1` env var (global default — env can be flipped on per-run via CLI).
3. Per-flag env var (`PIPELINE_TIERED_SOURCE_PROCESSING`, etc., `1` enables, `0` disables, default `1`).

If `forceFullQuality` resolves true, **all five flags are forced off** for that analysis and `forceFullQualityActive=true` is logged in `CostLog.flagBreakdown` for telemetry.

**Future migration:** the resolver returns a `PipelineFlags` object; call sites consume the typed shape. Moving from env vars to a `PipelineFlagConfig` row-per-key table later requires zero call-site changes — only the resolver's source of truth swaps.

## CostLog instrumentation

One new summary row per analysis (`agentType='pipeline_savings'`) with `flagBreakdown` JSON:

```json
{
  "estimatedFullCostUsd": 28.50,
  "actualCostUsd": 11.75,
  "savingsUsd": 16.75,
  "savingsPct": 58.8,
  "flagsActive": ["tiered_source_processing", "semantic_dedup", "regional_debate_pooling"],
  "flagsForcedOff": [],
  "perFlagSavings": {
    "tiered_source_processing": 6.20,
    "semantic_dedup": 4.10,
    "regional_debate_pooling": 6.45
  },
  "sourcesFiltered": {
    "below_uniqueness": 14,
    "regional_pool_overflow": 22,
    "tier_haiku_only": 8
  },
  "forceFullQualityActive": false
}
```

`forceFullQualityActive: boolean` lets us filter telemetry to show "real savings on optimized runs" vs "forced full runs are baseline" — admin requested per 2026-04-19 confirmation.

## Schema change

```sql
ALTER TABLE "CostLog" ADD COLUMN "flagBreakdown" JSONB;
ALTER TABLE "CostLog" ADD COLUMN "forceFullQualityActive" BOOLEAN NOT NULL DEFAULT false;
```

Both columns nullable / defaulted so existing rows survive the migration. Per-call CostLog rows leave `flagBreakdown` null; only the per-analysis summary row populates it.

## Touchpoints

- `prisma/schema.prisma` — add `flagBreakdown` + `forceFullQualityActive` to `CostLog`.
- `prisma/migrations/SESSION5_STEP1_pipeline_flag_telemetry.sql` — new migration.
- `src/lib/pipeline-flags.ts` — **new** — resolver + `PipelineFlags` type + `getActiveFlags(opts)` + `assertNonNegotiables(flags, source)`.
- `src/lib/pipeline.ts` — accept optional `forceFullQuality` in `VerifyPipelineOptions`, plumb resolved flags through to debate, write the summary CostLog row at end-of-analysis.
- `src/lib/debate.ts` — accept flags + tier metadata per source for flag 4 (early exit) and flag 5 (regional pooling).
- `src/agents/source-classifier.ts` — **new** — Haiku call for flag 2 (new vs continuing).
- `src/agents/source-uniqueness-scorer.ts` — **new** — Haiku call for flag 3.
- `src/lib/source-haiku-summary.ts` — **new** — reusable Haiku-summary path for sources that bypass full debate (flags 1, 2, 3, 5 all need this).
- `scripts/run-pipeline.ts` — accept `--force-full-quality` CLI flag.
- `CLAUDE.md` — admin-configurable settings section listing all six env vars + override.
- `src/__tests__/pipeline-flags.test.ts` — **new** — unit tests for resolver.
- `src/__tests__/cost-optimization-flag-1.test.ts` … `flag-5.test.ts` — **new** — integration tests per flag.

## Build order

This doc reflects a multi-turn build. **This turn — Foundation only:**

1. Migration SQL + `prisma/schema.prisma` update.
2. `lib/pipeline-flags.ts` — resolver + types + non-negotiable assertion + the unused `PipelineFlags` object plumbed nowhere yet.
3. Resolver unit tests.
4. CLI `--force-full-quality` arg in `scripts/run-pipeline.ts`.
5. CLAUDE.md updates.

Foundation has no behavioral impact. Default flags resolve on; resolver is unused until each flag's call site is wired in subsequent turns.

**Subsequent turns — one flag per turn, TDD:**

- Turn N+1 — Flag 1 (`tiered_source_processing`): biggest one. Touches `pipeline.ts` source assignment + `debate.ts` for tier-aware participation + new `source-haiku-summary.ts` for emerging/unclassified path.
- Turn N+2 — Flag 5 (`regional_debate_pooling`): builds on N+1's tier classification + Haiku-summary path.
- Turn N+3 — Flag 3 (`semantic_dedup`): independent — Haiku scorer stage between triage and debate.
- Turn N+4 — Flag 2 (`arc_rerun_differential`): Haiku classifier — depends on the Haiku-summary path being in place.
- Turn N+5 — Flag 4 (`confidence_threshold_exit`): inside `debate.ts` between R1 and R2.
- Turn N+6 — End-of-analysis CostLog summary writer (collects per-flag savings, writes one row).
- Turn N+7 — Manual smoke test: rerun a real arc with `PIPELINE_FORCE_FULL_QUALITY=1` baseline + with all flags on, compare cost + verdict.

Each flag turn = TDD. Tests first. Verify before declaring done.

## Risks + mitigations

- **R: Flag 4 (consensus exit) misjudges substance and skips legitimate cross-examination.**
  M: 3/4 with substantive third = the dissenter's R1 disagreement note must be empty/agreement-flavored, not a substantive contradiction. If the dissenter raised a substantive challenge, the claim is contested — full rounds run.
- **R: Flag 5 ranking is non-deterministic when tier + publishedAt tie.**
  M: Final tiebreaker is `Source.id` ascending. Reruns produce identical pools.
- **R: Flag 2's "20% sample of continuing coverage for stability check" pulls a handful of sources that, by chance, were the only ones with new claims; analysis misses material updates.**
  M: Sample is random per arc rerun (seeded by `Story.id` for reproducibility) and >0% — never zero sample. Quality review acts as backstop; flag 4's non-negotiable means contested claims still get full debate.
- **R: Tier metadata missing for fresh outlets (`tier='unclassified'`).**
  M: Resolver's non-negotiable assertion checks every source has a resolvable tier before flag 1 acts; unclassified is a real tier value (Haiku-summary) so this is a behavior, not a bug.
- **R: `PIPELINE_FORCE_FULL_QUALITY` accidentally left on in production env, all savings disappear silently.**
  M: When forced, log a warning every analysis: `[pipeline-flags] PIPELINE_FORCE_FULL_QUALITY active — all 5 cost-optimization flags bypassed. This run will cost ~2-5x baseline.` Telemetry filterable via `forceFullQualityActive` field.

## Acceptance — done when

- Resolver returns correct `PipelineFlags` for: defaults, all-off, force-full-quality, mixed env+CLI.
- Non-negotiable assertion throws when a tier-1 source would lose its model count, or when a contested claim would skip cross-examination.
- All 5 flags + override are documented in CLAUDE.md with the env var names.
- `npm test` green.
- Manual smoke: same-arc rerun with force-full vs flags-on shows 60%+ savings on arc rerun, 40%+ on fresh, no kill verdict regression on the optimized run.
