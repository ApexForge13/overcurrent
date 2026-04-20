@AGENTS.md

# CLAUDE.md — Overcurrent

## What This Is

Overcurrent (overcurrent.news / overcurrent.org) is a transparent global news coverage analysis platform. NOT a news organization. Cross-references 1,000+ sources across 50+ countries in 17+ languages using 4 AI models in a 3-round debate format.

Tagline: "Every outlet shows you their version. We show you everyone's."

## Tech Stack

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Database:** PostgreSQL via Prisma ORM (Supabase)
- **Queue/Pipeline:** Redis + BullMQ
- **AI Models:** Claude Sonnet (analysis + moderation), GPT-5.4, Gemini 2.5 Pro, Grok 4 (OpenAI-compatible API). Haiku for triage/classification/ad copy.
- **Data Ingestion:** GDELT + RSS feeds + custom scrapers + Reddit JSON API + Twitter/X API v2 + Telegram channels
- **Styling:** Tailwind CSS, dark editorial theme
- **Deployment:** Vercel
- **Pipeline Runner:** Railway
- **Payments:** Stripe
- **Email:** Resend

## Design System

- Headlines: Playfair Display (bold, 28-48px)
- Body: IBM Plex Sans
- Data/Mono: JetBrains Mono
- Background: `#0A0A0B` | Text: `#E8E6E3`
- Teal: `#2A9D8F` | Red: `#E24B4A` | Blue: `#378ADD` | Amber: `#F4A261` | Green: `#00F5A0`
- NOT card-based — text-density first, no gradients, row-based layouts
- Thin section headers with rules (── TITLE ────)
- Confidence bars, not pie charts. Monospace for data values.

## Core Pipeline

```
Story Input → GDELT + RSS + Scrapers (Gather)
  → Source Triage (201+ outlets, target 700+)
    → 4-Model Debate (3 rounds)
      → R1: Independent analysis (24 parallel calls/region, 6 regions)
      → R2: Cross-examination (models challenge each other)
      → R3: Moderator synthesis (Claude Sonnet)
    → Social Draft Generation (6+ drafts)
      → Admin Portal Review → Human approval → Publish
```

Nothing auto-publishes. Everything goes through admin review.

## Language Rules (Non-Negotiable)

| Never Say | Say Instead |
|---|---|
| "unbiased" | "transparent" |
| "verified" | "high confidence" |
| "outlet did not report" | "not found in available coverage" |

## Code Rules

- No hardcoding API keys
- All Claude calls through wrapper function
- JSON-only responses with error handling
- Haiku for triage, Sonnet for analysis
- NEVER fabricate data or estimates — say "I don't know"
- Wire copy deduplication: 30 AP reprints ≠ 30 sources
- Check for hallucinated outlet names
- Social media data NEVER affects confidence scores (firewall between news analysis and discourse)

## Pipeline Cost-Optimization Flags (admin-configurable)

Five flags + one override gate cost-optimization stage skips in `runVerifyPipeline`. All five flags default ON. The override forces full debate quality regardless of flag state. Spec: `docs/plans/2026-04-19-cost-optimization-layer.md`. Resolver: `src/lib/pipeline-flags.ts`.

| Env var | Default | When OFF |
|---|---|---|
| `PIPELINE_TIERED_SOURCE_PROCESSING` | on | All sources get full 4-model debate regardless of outlet tier. |
| `PIPELINE_ARC_RERUN_DIFFERENTIAL` | on | Arc reruns re-debate every continuing-coverage source. |
| `PIPELINE_SEMANTIC_DEDUP` | on | Sources adding no new claims still enter the debate. |
| `PIPELINE_CONFIDENCE_THRESHOLD_EXIT` | on | All claims run R2 + R3 even when R1 hit ≥85% consensus. |
| `PIPELINE_REGIONAL_DEBATE_POOLING` | on | Every regional source gets full debate (no top-8 cap). |
| `PIPELINE_FORCE_FULL_QUALITY` | off | When on (`=1`), all five flags are forced off for the run. Use for flagship arc analyses, enterprise demos, anything bound for the public accuracy tracker. |

Per-run overrides:
- CLI: `npx tsx scripts/run-pipeline.ts --force-full-quality "your query"`
- Programmatic: `runVerifyPipeline(query, onProgress, { forceFullQuality: true })`
- Per-call arg wins over env when strictly `true`; otherwise env applies.

Recognized env values: `0`, `false`, `off`, `no` (case-insensitive, trimmed) → disabled. Anything else → enabled.

Two non-negotiable invariants enforced by `assertTier1FullDebate` + `assertContestedClaimDebated` in the resolver — both throw on violation rather than silently degrading:
1. Tier-1 sources (`wire_service`, `national`) always get full 4-model debate.
2. Cross-examination (R2 + R3) never skips on contested claims.

Per-analysis savings telemetry lands in `CostLog.flagBreakdown` JSON (`agentType='pipeline_savings'`); `CostLog.forceFullQualityActive` separates optimized runs from forced-full baseline runs.

## Key Database Models

- `DebateRound` — stores full round JSON per model/region
- `DiscourseSnapshot`, `DiscoursePost`, `DiscourseGap` — social discourse analysis
- `buried_evidence` — preserves findings across re-analysis runs (additive only, never delete)
- `OutletAccuracyEvent`, `PropagationEvent`, `OutletFramingEvent` — learning system
- `ModelPerformanceEvent`, `TrustDivergence` — long-term data assets
- `FactSurvival` — tracks which facts die at which editorial boundary

## Re-Analysis Rules

- NEVER delete findings when a new run produces different results — accumulate
- If a finding appears in 2+ runs, upgrade to "corroborated"
- Published reports show union of ALL findings across ALL runs
- Admin can mark findings as "retracted" or "superseded" (only way to remove)

## Known Bugs (Priority Order)

1. Source deduplication (The Hill 16x, Axios 14x) — fix: max 3 articles/outlet in triage
2. Regional diversity (1,844 sources enter triage, only 4 countries survive) — fix: enforce minimums per region
3. Propagation map not rendering all sources
4. Irrelevant Reddit posts in discourse gap — needs 2+ keyword match filtering
5. Twitter/X data fetched but not appearing in output
6. Confidence bars showing 0% — fix: cap single-source at 40%, scale with 2-10 sources
7. Free read count set to 10, should be 5
8. Stripe in test mode
9. Email/DKIM verification
10. Non-English outlet parsing
11. State media RSS feeds broken (PressTV, Tasnim, Fars, RT, Xinhua)
12. Cost logging DB table not implemented
13. Mobile layout issues (3-column debate cards, text clipping, landscape distortion)

## Design Documents

Reference these by name when working on specific systems:

- `OVERCURRENT-FINAL-PROMPT` — Master build prompt, DB schema, file structure
- `OVERCURRENT-DEBATE-ARCHITECTURE` — 4-model 3-round debate system
- `OVERCURRENT-SOCIAL-AUTOMATION` — Social draft generation + admin panel
- `OVERCURRENT-DESIGN-SYSTEM` — Full theme spec
- `OVERCURRENT-STORY-OUTPUT-FORMAT` — Verdict-first page design
- `OVERCURRENT-LEARNING-SYSTEM` — 6 feedback loops
- `OVERCURRENT-PROPAGATION-ZOOM` — Multi-scale map + "Facts That Died"
- `OVERCURRENT-DISCOURSE-LAYER` — Social discourse analysis + gap scoring
- `OVERCURRENT-REANALYSIS-VERSIONING` — Additive-only re-analysis system
- `OVERCURRENT-CUMULATIVE-BURIED-EVIDENCE` — Cross-run finding preservation
- `OVERCURRENT-AUDIT-FIXES` — Presentation layer fixes from live review
- `OVERCURRENT-FULL-SEND-OVERHAUL` — 500+ source expansion plan
