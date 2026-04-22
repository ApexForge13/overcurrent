# Phase 1c.2b Planned Changes Manifest — Integrations + Triggers (full universe)

> **Status:** Planning. Not approved for execution.
> **Branch (on approval):** `pivot/phase-1c-2b-integrations-triggers` off `main` @ 0b5c605
> **Depends on:** Phase 1c.2a merged (migration applied, entities reseeded).

## Phase split recommendation — read first

Phase 1c.2b as scoped is ~11-13 hours of work. I recommend splitting into **1c.2b.1**, **1c.2b.2**, and **1c.2b.3** along two clean seams:

- **API-key availability.** 1c.2b.1 ships without needing POLYGON / DCF / DATADOCKED keys. That's a real seam — you can run and verify 1c.2b.1 against dev today; 1c.2b.2 either waits for keys or ships behind flags.
- **Tech-debt vs. new capability.** The Phase 1c.2a deferred tech debt (Form 4 XML parse, Senate PTR CSRF flow, Congress PTR PDF parse) is its own shape of work — three unrelated scraper-tightenings on already-functional triggers. Bundling them into a new-capability phase dilutes both. They're better as a discrete 1c.2b.3 cleanup sweep.

**Proposed three-way split:**

| Phase | Scope | Est. hours | API keys needed |
|---|---|---|---|
| **1c.2b.1** | Adapter refactor + N1-N4 + P1-P4 + T-GT4 (CFTC) | 6-7 | none |
| **1c.2b.2** | Polygon (T-GT5/6/12) + Data Docked gated (T-GT7 + scanTier) + T-GT8 (EIA wiring) + DCF (T-GT11) + `/admin/triggers` UI + `TriggerEnablement` table | 5-6 | POLYGON, DATADOCKED (already have key, tier upgrade pending), DCF — all gated behind key-presence checks per manifest scope #10 |
| **1c.2b.3** | Phase 1c.2a tech debt sweep: Form 4 XML parse, Senate PTR session flow, Congress PTR PDF parse | 3-4 | none |

**This manifest details 1c.2b.1 only.** 1c.2b.2 and 1c.2b.3 sketched at the end.

**Alternative: keep as one phase.** If you want a single monolithic 1c.2b, I'll rework. My recommendation is the split — the three-part structure matches how the work actually groups.

---

## Phase 1c.2b.1 — adapter refactor + narrative/psych triggers + CFTC COT

**Goal:** Wire Streams 1 (narrative) and 2 (psychological) into the Gap Score pipeline end-to-end: entity-linked article/post ingestion, per-entity baseline computation workers, eight trigger implementations (T-N1/2/3/4 + T-P1/2/3/4), and T-GT4 (CFTC Commitments of Traders). After this lands, the trigger stream is ~3× more productive than today — every tracked entity gets a per-hour narrative+social observation feeding TriggerEvent.

**Architecture:**
- **No changes to the ingestion primitives** (`src/ingestion/gdelt.ts`, `rss.ts`, `reddit.ts`, `twitter-discourse.ts`). They already return pure article/post arrays — cluster-decoupled. What they lack is the "emit entity-linked events" layer.
- **New `src/lib/gap-score/narrative/` and `src/lib/gap-score/psychological/` directories.** These host per-stream pollers that:
  1. Call the existing ingestion function on a schedule (hourly or faster),
  2. Run entity extraction against the fetched content (ticker regex + fuzzy alias match against `TrackedEntity.entityStrings.aliases`),
  3. Persist observation rows in new `EntityObservation` and `EntityObservationHourly` tables for baseline computation,
  4. Evaluate trigger-specific fire conditions and emit `TriggerEvent` rows.
- **Baseline workers** (new `pipeline-service/baseline-worker.ts`) run hourly, compute rolling mean/stddev over the prior 7d (narrative) or 14d (psych), upsert `EntityBaseline` rows, and flip `isMature` when `sampleCount >= minSampleSize`.
- **Triggers query baselines** via the existing `isEntityMetricMature` helper (already wired in `maturity-gate.ts`).
- **CFTC COT adapter** (new `src/lib/raw-signals/integrations/cftc-cot.ts`) pulls the weekly report, parses it into `CftcPositionDelta` rows stored in a new `CftcPosition` table, and T-GT4 scans week-over-week deltas.

**Tech Stack:** no new runtime deps. Using existing BullMQ, Prisma, Upstash Redis, FRED (already provisioned). Entity extraction uses regex-level matching + a lightweight alias index — no LLM calls per article (cost discipline).

**Estimated effort:** 6-7 hours.

---

## Files to create

### Schema additions
- `prisma/schema.prisma`: three new models.
  - `EntityObservation` — one row per (entity, timestamp, sourceType) tuple. Rolling stream — aged out >30 days.
  - `EntityObservationHourly` — pre-aggregated hourly counts by (entity, metricName, hourStart). Feeds baselines directly without scanning every observation. Kept 90 days rolling.
  - `CftcPosition` — weekly COT snapshots per commodity-exchange pair. Used by T-GT4.
- `prisma/migrations/PHASE1C2B1_observation_tables_plus_cftc.sql` — manual SQL file matching project convention.

### Entity extraction layer
- `src/lib/entity-extraction/alias-index.ts` — builds an in-memory trie/map of `TrackedEntity.identifier + entityStrings.aliases → entityId`. Rebuilt on first use, refreshed every 6h via a module-level cache with TTL. Pure TS, testable.
- `src/lib/entity-extraction/extract-from-text.ts` — takes a string + alias index, returns `{ entityId, matchedAlias, matchType: 'cashtag' | 'alias' | 'ticker_regex' }[]`. Cashtag first ($AAPL), then exact uppercase ticker word boundary, then alias substring match with word-boundary guard to reduce false positives. Returns deduplicated by entityId.
- `src/__tests__/entity-extraction-alias-index.test.ts` — 4 tests: build, cache hit, cache miss reload, ticker vs alias ordering.
- `src/__tests__/entity-extraction-extract.test.ts` — 6 tests: cashtag match, plain ticker, alias substring, word-boundary rejection of partial matches, dedup across multiple matches, empty text.

### Narrative layer (Stream 1)
- `src/lib/gap-score/narrative/gdelt-poller.ts` — polls `src/ingestion/gdelt.ts` on an interval (driven by BullMQ scheduler), runs entity extraction on each article title + description, writes `EntityObservation` rows. Cursor-persisted via `TriggerCursor` (cursorType='gdelt_last_seen_url'). Rate-limited to 100 articles/poll.
- `src/lib/gap-score/narrative/rss-poller.ts` — same pattern for `src/ingestion/rss.ts`. Uses `TriggerCursor` cursorType='rss_last_seen_guid'.
- `src/lib/gap-score/narrative/observation-aggregator.ts` — promotes `EntityObservation` rows into `EntityObservationHourly` counts. Idempotent (unique on entity+metricName+hourStart).
- `src/lib/gap-score/narrative/narrative-baseline-worker.ts` — baseline recomputation: reads `EntityObservationHourly` for each entity with metricName='article_volume_hourly', computes rolling 7d mean/stddev, upserts `EntityBaseline`. Sets `isMature=true` when sampleCount ≥ 120.
- `src/lib/gap-score/triggers/narrative/article-volume-spike.ts` — T-N1 implementation. Reads current hour observation, compares to baseline (z = (current - mean) / stddev). Fires on z > 2 AND current ≥ 5. Severity = min(z/4, 1.0). Direction = 0 (determined downstream).
- `src/lib/gap-score/triggers/narrative/cross-outlet.ts` — T-N2. 30-min window. Counts DISTINCT outlets per entity (from EntityObservation.outlet field). Fires when ≥5 outlets AND not during scheduled-event quiet periods (FOMC day, major earnings — empty set in 1c.2b.1, placeholder hook for later). Severity 0.5 at 5, scales to 1.0 at 10+.
- `src/lib/gap-score/triggers/narrative/wire-headline.ts` — T-N3. Regex patterns per the Phase 1 addendum A1.2 T-N3 spec (earnings beat/miss, guidance, M&A, regulatory, exec change, bankruptcy, contract). Entity must be in title, not just body. Severity 1.0. Per-pattern direction (+1 approval, -1 fine, 0 ambiguous). Pattern list exported as `src/lib/gap-score/triggers/narrative/wire-patterns.ts` for maintainability.
- `src/lib/gap-score/triggers/narrative/sentiment-extremity-batch.ts` — T-N4. 2h window, directional keyword match. Bullish + bearish keyword lists per addendum exported as `src/lib/gap-score/triggers/narrative/keyword-lists.ts`. Fires when ≥8 keyword-match articles AND ≥60% same direction. Severity by count + consistency.
- `src/__tests__/narrative-gdelt-poller.test.ts` — 5 tests: fetch + entity match + observation write, cursor advancement, dedup on cursor replay, rate cap, no-match article skipped.
- `src/__tests__/narrative-rss-poller.test.ts` — 4 tests (same shape, GUID cursor).
- `src/__tests__/narrative-observation-aggregator.test.ts` — 3 tests: hourly rollup, idempotent re-aggregation, cross-hour boundary.
- `src/__tests__/narrative-baseline-worker.test.ts` — 4 tests: rolling mean/stddev, maturity flip at 120 samples, entity with no observations (skip), stale data eviction.
- `src/__tests__/trigger-t-n1-article-volume.test.ts` — 6 tests: z>2 fire, z<2 no-fire, absolute floor of 5, severity cap, mature-baseline gate, direction=0.
- `src/__tests__/trigger-t-n2-cross-outlet.test.ts` — 4 tests: ≥5 outlets fire, <5 no-fire, severity scaling, 30-min window enforcement.
- `src/__tests__/trigger-t-n3-wire-headline.test.ts` — 8 tests: one per pattern category (earnings/guidance/M&A/regulatory/exec/bankruptcy/contract) + title-only requirement.
- `src/__tests__/trigger-t-n4-sentiment-extremity.test.ts` — 5 tests: bullish batch fire, bearish batch fire, 60% consistency gate, <8 articles no-fire, severity scaling.

### Psychological layer (Stream 2)
- `src/lib/gap-score/psychological/reddit-poller.ts` — polls `src/ingestion/reddit.ts` subreddit-by-subreddit. Pulls top + new posts/comments, cashtag extraction, writes `EntityObservation` rows with sourceType='reddit', engagement fields (upvotes, comment_count).
- `src/lib/gap-score/psychological/twitter-poller.ts` — polls `src/ingestion/twitter-discourse.ts`. Cashtag-based search against the tracked-entity cashtag set (derivable from `entityStrings.aliases`). Writes `EntityObservation` rows with sourceType='twitter', engagement fields.
- `src/lib/gap-score/psychological/psych-baseline-worker.ts` — same shape as narrative-baseline-worker but for two metrics: `cashtag_velocity_hourly` (14-day, minSample 240) and `engagement_velocity_4h` (rolling comparison, 48 observations minimum).
- `src/lib/gap-score/triggers/psychological/cashtag-velocity.ts` — T-P1. z > 3 AND current ≥ 20. Severity by z-score, cap at z=5.
- `src/lib/gap-score/triggers/psychological/engagement-velocity.ts` — T-P2. Last-1h engagement rate vs previous-1h rate. Fires at 2x+ acceleration AND ≥100 engagement events in last hour. Severity by acceleration factor.
- `src/lib/gap-score/triggers/psychological/cross-platform-amplification.ts` — T-P3. Meta-trigger over `TriggerEvent` table: T-P1 fires on same entity across ≥2 distinct platforms within 2h. Severity 0.6 at 2, 1.0 at 3+.
- `src/lib/gap-score/triggers/psychological/sentiment-extremity-consensus.ts` — T-P4. Directional keyword match on post content, 2h window, ≥30 posts AND ≥75% same direction.
- `src/__tests__/psych-reddit-poller.test.ts` — 4 tests.
- `src/__tests__/psych-twitter-poller.test.ts` — 4 tests.
- `src/__tests__/psych-baseline-worker.test.ts` — 4 tests (parallel to narrative baseline worker).
- `src/__tests__/trigger-t-p1-cashtag-velocity.test.ts` — 5 tests.
- `src/__tests__/trigger-t-p2-engagement-velocity.test.ts` — 5 tests.
- `src/__tests__/trigger-t-p3-cross-platform.test.ts` — 4 tests.
- `src/__tests__/trigger-t-p4-sentiment-consensus.test.ts` — 5 tests.

### CFTC COT layer
- `src/lib/raw-signals/integrations/cftc-cot.ts` — new adapter. Fetches CFTC's weekly Commitments of Traders disaggregated report (free public CSV at `https://www.cftc.gov/dea/newcot/deafut_xls.htm`). Parses CSV, upserts `CftcPosition` rows keyed on (marketCode, exchangeCode, reportDate).
- `src/lib/gap-score/triggers/ground-truth/cftc-managed-money.ts` — T-GT4 trigger. Reads two most recent `CftcPosition` rows per market, computes week-over-week delta in managed money net %. Fires when |Δ| > 10%. Severity log-scaled (10% → 0.4, 25% → 0.8, 50%+ → 1.0). Direction: net long increase → +1, net short increase → -1. Resolves market codes to `TrackedEntity` via new `src/lib/gap-score/triggers/ground-truth/cftc-entity-resolver.ts` (hand-curated: CL=F ↔ NYMEX WTI, HG=F ↔ COMEX Copper, etc.).
- `src/__tests__/cftc-cot-adapter.test.ts` — 5 tests: CSV parse, upsert idempotency, market-code normalization, missing-report tolerance, historical backfill.
- `src/__tests__/trigger-t-gt4-cftc.test.ts` — 5 tests: delta threshold fire, sub-threshold no-fire, direction on net-long increase, severity ladder, unresolved market code → CostLog.

### Worker + scheduler wiring
- `pipeline-service/baseline-worker.ts` — new worker entry. Listens on new queue `gap-score-baseline-compute`. Processor runs narrative + psych baseline recomputes in sequence every hour.
- `pipeline-service/narrative-poller-worker.ts` — new worker entry. Listens on `narrative-ingest` queue. Processor runs GDELT + RSS pollers on a 15-min schedule.
- `pipeline-service/psych-poller-worker.ts` — new worker entry. Listens on `psych-ingest` queue. Reddit + Twitter polling on 15-min schedule.
- `pipeline-service/candidate-generator-worker.ts` — **modify** to register the eight new trigger schedulers (T-N1-4 every 5min, T-P1-4 every 5min, T-GT4 Friday 17:00 ET).
- `src/lib/queue/names.ts` — add `GAP_SCORE_BASELINE_COMPUTE`, `NARRATIVE_INGEST`, `PSYCH_INGEST`. New prefixes `narrative-ingest` and `psych-ingest` (their own domain prefix per our queue-names contract).
- `src/__tests__/queue-names.test.ts` — expect 13 queues, extended prefix list.
- `src/lib/gap-score/triggers/registry.ts` — register all 9 new triggers (T-N1/2/3/4 + T-P1/2/3/4 + T-GT4) with env-var gates `TRIGGER_T_N1_ENABLED`, etc.

### Keyword + pattern lists (exported for admin UI consumption in 1c.2b.2)
- `src/lib/gap-score/triggers/narrative/keyword-lists.ts` — BULLISH / BEARISH arrays per addendum. Exported + frozen.
- `src/lib/gap-score/triggers/narrative/wire-patterns.ts` — array of `{ id, pattern: RegExp, category, direction }`. Same surface.

---

## Files to modify

- `prisma/schema.prisma` — three new models (see above).
- `pipeline-service/candidate-generator-worker.ts` — 9 new trigger schedulers.
- `src/lib/queue/names.ts` — 3 new queues.
- `src/__tests__/queue-names.test.ts` — count assertion + prefix set.
- `src/lib/gap-score/triggers/registry.ts` — 9 new entries.
- `pipeline-service/worker.ts` — concurrency map gets three new queue entries.

**No changes to:** existing ingestion primitives, existing triggers (T-GT1/2/3/9/10, T-META1/2), runner (already entity-capable post-1c.2a), macro-surprise direction maps.

---

## Expected test delta

Current baseline: 695 passing.

**Added:** ~95 tests across 18 new test files.

| File | Tests |
|---|---|
| entity-extraction-alias-index | 4 |
| entity-extraction-extract | 6 |
| narrative-gdelt-poller | 5 |
| narrative-rss-poller | 4 |
| narrative-observation-aggregator | 3 |
| narrative-baseline-worker | 4 |
| trigger-t-n1-article-volume | 6 |
| trigger-t-n2-cross-outlet | 4 |
| trigger-t-n3-wire-headline | 8 |
| trigger-t-n4-sentiment-extremity | 5 |
| psych-reddit-poller | 4 |
| psych-twitter-poller | 4 |
| psych-baseline-worker | 4 |
| trigger-t-p1-cashtag-velocity | 5 |
| trigger-t-p2-engagement-velocity | 5 |
| trigger-t-p3-cross-platform | 4 |
| trigger-t-p4-sentiment-consensus | 5 |
| cftc-cot-adapter | 5 |
| trigger-t-gt4-cftc | 5 |
| queue-names (modified) | +0 |

**Expected post-phase:** ~790 tests across ~76 files.

---

## Ambiguities — need your decision before I execute

**1. Entity extraction strategy.**
Options: (a) pure regex + alias trie lookup (fast, deterministic, no LLM cost); (b) Haiku-powered NER on articles scoring low confidence with regex; (c) defer to downstream pipeline. My default: **(a) pure regex + alias trie.** LLM per article at scale gets expensive; our trigger stream is volume-driven and the downstream scoring phase (Phase 2) runs LLM exactly where it's worth running. If we see false-positive noise post-launch, 1c.2b.4 can layer Haiku on flagged observations.

**2. Telegram coverage.**
Scope mentions Telegram but there's no existing integration in `src/ingestion/`. Including it means building a new client (Bot API + channel subscriptions + parsing). My default: **defer Telegram to a follow-up.** Reddit + Twitter cover the bulk of psych signal; Telegram is an incremental add. Flag-check if you want it in 1c.2b.1.

**3. Observation retention.**
`EntityObservation` rows accumulate fast — at 15-min polling intervals × 11K entities × some avg hit rate, we could be looking at 100K+ rows/day at launch. My default: **30-day rolling retention on `EntityObservation`, 90-day on `EntityObservationHourly`.** A nightly cleanup job drops older rows. Baselines compute from the hourly rollup, not the raw observations, so retention doesn't affect baseline accuracy.

**4. Baseline worker cadence.**
Options: (a) hourly recompute for all entities (simple, predictable cost), (b) per-entity on-demand (cheap but complex), (c) tiered — featured set hourly, rest every 4h. My default: **(a) hourly recompute** for all mature+calibrating entities. The DB aggregation is cheap (few-second run over the hourly rollup table), predictable cost, and supports baseline-maturity transitions cleanly.

**5. T-N2 "not during known scheduled events" guard.**
Per addendum: "AND NOT during a known scheduled event (earnings, Fed day)". Implementing this cleanly needs an earnings calendar + Fed calendar. We have neither at the tracked-ticker scale. My default: **ship T-N2 without the quiet-period guard in 1c.2b.1**; document the gap; add the calendar in 1c.2b.2 when scanned. Acceptable false-positive risk: handful of 5-outlet-cluster fires around FOMC that the downstream Gap Score deprioritizes.

**6. Baseline minSampleSize seeding.**
Current `EntityBaseline.minSampleSize` is written by the baseline worker itself (per the Phase 1 addendum floors). Alternatively, we could pre-populate a row per (entity × metricName) with isMature=false + minSampleSize set. My default: **lazy — baseline worker creates the row on first observation.** Simpler, avoids a one-shot seed script.

**7. Twitter/X API rate limits.**
Existing `src/ingestion/twitter-discourse.ts` uses TWITTER_BEARER_TOKEN. Rate limits on the current tier are tight. Cashtag-level polling across 11K entities every 15 min would blow the budget. My default: **featured set only** for T-P1 initial scope — ~50 entities. Scale up to tracked-ticker-wide when we validate rate-limit headroom. Flag for your decision.

**8. CFTC COT report caching.**
CFTC publishes the full historical COT CSV each Friday — large file. Options: (a) download and parse in-memory per scan, (b) cache the CSV file on disk with content-hash, parse only when new. My default: **(a) fetch fresh.** File is ~2MB gzipped, parse is fast; cache complexity isn't warranted at weekly cadence.

---

## Pre-execution verification gates

- Baseline: `npm test` → 695.
- `npx tsc --noEmit` → 0 errors.
- `npx prisma validate` → 0 errors.
- Migration generated but NOT applied until manifest approval.

## Post-execution verification gates

- `npm test` → ~790 (±10), 0 failures.
- `npx tsc --noEmit` → 0.
- `npx next build` → exit 0.
- Manual: queue narrative-ingest job for a featured-set entity, verify `EntityObservation` row lands. Verify baseline worker updates `EntityBaseline` on schedule. Verify one T-GT4 scan against real Friday COT data (if execution lands on Fri/weekend — otherwise defer the live smoke to the following Friday and flag in the post-merge handoff).

## Git hygiene

- Branch: `pivot/phase-1c-2b-1-narrative-psych` off `main` @ 0b5c605.
- Commits per milestone, ~8-10 total.
- Push to origin once all verification gates pass.

---

## Phase 1c.2b.2 — paid integrations + admin UI (preview, ~5-6 hours)

**Scope:**
- `src/lib/raw-signals/clients/polygon-client.ts` — refactor/extract Polygon HTTP layer so both legacy adapter and new triggers can share. Add snapshot endpoint + unusual-options-activity endpoint.
- T-GT5 intraday price move, T-GT6 overnight gap — both use 30d realized volatility per category (equity 3%/2%, commodity 2%/1%, crypto 5%/4%). Baselines come from Polygon daily bars.
- T-GT12 options flow — unlock from gated state using the same Polygon client.
- `src/lib/raw-signals/integrations/datadocked.ts` — extend with zone-scoped scanner, `DATADOCKED_SCANNING_ENABLED` env gate, scanTier scheduling (Tier 1 2x/day, 2 1x/day, 3 0.5x/day).
- T-GT7 maritime trigger + baseline maturity gate against existing `ZoneBaseline`.
- T-GT8 inventory release trigger — wires existing EIA data to trigger logic; USDA stub returns 0 fires.
- `src/lib/raw-signals/integrations/dcf-earnings.ts` — DCF API client. T-GT11 fires on transcript availability (no Haiku sentiment in this phase per scope #8 guidance).
- `src/app/admin/triggers/page.tsx` — admin UI. Table of all 20+ triggers, per-row enable/disable toggle, threshold tuning, firing-rate stats. Baseline maturity status table.
- `prisma/schema.prisma` — new `TriggerEnablement` model (triggerId, enabled, thresholdOverrides JSON, updatedAt, updatedBy).
- Unpaid-service handling per scope #10: each new trigger checks env-var presence; if missing, writes CostLog `operation='disabled:missing-key'` heartbeat once per hour (dedup via TriggerCursor or simple timestamp check) and returns empty.
- `MonitoringZone.scanTier` added as a TS field (not DB — zones are code artifacts), populated for all 43 zones.

**Value gating at ship time:**
- T-GT7 dormant until `DATADOCKED_SCANNING_ENABLED=true` (even with key) AND zone baselines mature.
- T-GT5/GT6/GT12 fire immediately with POLYGON_API_KEY; price baselines need 25 trading days.
- T-GT8 fires immediately on the next EIA release post-deploy (historical proxies already populated).
- T-GT11 fires immediately with DCF_API_KEY on new earnings transcripts.
- Admin UI functional on deploy; firing-rate columns show 0 until 1c.2b.1's pollers accumulate data.

---

## Phase 1c.2b.3 — 1c.2a tech debt sweep (preview, ~3-4 hours)

**Scope:**
- **Form 4 XML parse** — fetch accession archive, parse `<nonDerivativeTransaction>` blocks for transactionShares, transactionPricePerShare, transactionCode. Flips T-GT1 dollar-threshold firings on (currently only the 48h cluster rule is live).
- **Senate PTR session flow** — scrape the "agree to terms" page to acquire a session cookie + CSRF token, then hit the search endpoint. `fetchSenatePtrs` returns real data. Needs `cheerio` or manual HTML parsing.
- **Congress PTR PDF parse** — add `pdfjs-dist` or `pdf-parse` dep. Extract the structured table rows (asset name, transaction type, date, amount bucket). Feeds ticker + amountBucket into T-GT10 fires, enabling the high-value + multi-member elevation conditions to trigger.

**Low priority flag:** all three items have functional proxies today. Form 4 cluster rule catches the same insider activity clusters that dollar thresholds would — just at different severity. Senate PTR gap means T-GT10 is House-only (Senate trades are rarer anyway). Congress PDF parse gap means amount-elevation doesn't trigger (base severity still fires). Lowest-risk deferral path if you want to skip 1c.2b.3 entirely until post-launch validation reveals which proxy is actually degrading signal quality.

---

## Decision needed from you

1. **Accept three-way split** (1c.2b.1 + 1c.2b.2 + 1c.2b.3), or keep as one phase?
2. Answers to the 8 ambiguities (or "go with your defaults").
3. Green-light 1c.2b.1 as scoped.
4. Confirm: is it OK that 1c.2b.3 (tech debt) is truly optional / may never land if proxies prove sufficient?
