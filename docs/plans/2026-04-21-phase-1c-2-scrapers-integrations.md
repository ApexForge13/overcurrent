# Phase 1c.2 Planned Changes Manifest — Scrapers + Integrations + Refactor

> **Status:** Planning document. Not approved for execution.
> **Branch (on approval):** `pivot/phase-1c-2a-foundation` off `main` @ 8f81445
> **Depends on:** Phase 1c.1 merged (trigger framework, 3 live triggers, 4 scaffolded).

## Phase split recommendation — read first

Phase 1c.2 as originally scoped is ~10–12 hours of work. I recommend splitting it into **1c.2a** (foundation) and **1c.2b** (long tail) for three reasons:

1. **Different risk profiles.** 1c.2a is well-bounded modifications and one new scraper per target site. 1c.2b adds 3 new data integrations (CFTC, price feed, earnings provider) plus 8 new triggers that each need their own baseline-maturity plumbing — very different shape of work.
2. **Immediate value gate.** 1c.2a flips a binary: 4 scaffolded triggers go from `returning []` to firing. T-GT9 starts firing on every macro release with consensus. That's testable the day after merge. 1c.2b value is partly time-deferred (narrative/psych baselines need 7–18 days to mature).
3. **The admin UI decision point lives between them.** Admin trigger-tuning UI makes most sense to build *after* we see which triggers actually fire noisily. Slotting it in 1c.2b (after we have live data from 1c.2a) is better than building a UI for hypothetical firing rates.

**This manifest covers 1c.2a only.** 1c.2b is sketched at the end for visibility. Approve/revise this split first; if you want a single phase, I'll rework the manifest.

---

## Phase 1c.2a — Foundation

**Goal:** Refactor the legacy signal runner to support entity-linked contexts, ship the 4 scaffolded ground-truth triggers (T-GT1, T-GT2, T-GT3, T-GT10), land the consensus-data scrapers (unblocks T-GT9 firings), and clean up the three known 1c.1 tech-debt items.

**Architecture:**
- **Path A** refactor: `RawSignalLayer` + `RawSignalQueue` get a nullable `entityId` FK to `TrackedEntity` alongside the existing `storyClusterId` (which becomes nullable). Runner accepts entity-scoped contexts. No parallel table. Legacy cluster-scoped adapters keep working unchanged when invoked by gated pipeline code.
- **Client extraction:** SEC EDGAR's HTTP + parsing logic moves from `sec-edgar.ts` into a reusable `sec-edgar-client.ts`. Trigger functions call the client directly (cursor-polling mode) without going through the runner, since triggers don't need a `RawSignalLayer` audit row per filing — they emit `TriggerEvent` rows instead. Writing raw signals IS additive-only for future forensic use; the legacy adapter still routes its writes through the runner.
- **Consensus scraper:** new `src/lib/macro/consensus/` package with Investing.com (primary) + Trading Economics (backup) HTML scrapers. Scheduled via existing BullMQ `TRIGGER_SCAN` queue or a new `macro-consensus-scrape` queue (see Ambiguity #3).
- **Congressional-trade adapter:** new `src/lib/raw-signals/integrations/congress-trade.ts` that polls House + Senate PTR disclosures. The existing `src/ingestion/congress.ts` (bills legislation, not trades) stays untouched — different data source, different purpose.

**Tech Stack:** no new deps expected. Prisma 7, BullMQ 5, Upstash Redis, FRED/EIA already wired. HTML scraping uses `fetch` + regex (no JSDOM/Playwright — keeps it ops-safe on Railway).

**Estimated effort:** ~5–6 hours.

---

## Files to create

### Adapter refactor + SEC EDGAR client extraction
- `src/lib/raw-signals/clients/sec-edgar-client.ts` — pure fetch/parse module. Exports `pollRecentFilings({ sinceCursor, forms })`, `searchByEntity({ entities })`. Unit-testable in isolation.
- `src/__tests__/sec-edgar-client.test.ts` — 6 tests covering fetch, form-type filtering, cursor advancement, 403/429 routing, parse error, empty result.

### T-GT1 / T-GT2 / T-GT3 trigger implementations (replace existing stubs)
- Implementations go **into the existing scaffold files**: `src/lib/gap-score/triggers/ground-truth/sec-form-4.ts`, `sec-13d-g.ts`, `sec-8-k.ts`. No new files here — just replacing the stub bodies.
- `src/lib/gap-score/triggers/ground-truth/sec-cursor.ts` — cursor persistence helper. Uses a new `TriggerCursor` model (see schema changes) so each SEC trigger remembers its last-polled filing date. Prevents re-firing on every 30-min scan.
- `src/lib/gap-score/triggers/ground-truth/sec-entity-resolver.ts` — given an EDGAR hit (CIK + ticker), look up `TrackedEntity.providerIds.cik` (extended to also match by identifier/ticker). Unresolved hits → `CostLog` row with `operation='sec-unmatched-filing'`.
- `src/__tests__/trigger-sec-form-4.test.ts` — 6 tests: fires on $1M+ transaction, fires on 10%+ holding, fires on 2+ insiders same direction, buy=+1 / sell=-1 direction, respects cursor, unresolved-ticker cost-logs.
- `src/__tests__/trigger-sec-13d-g.test.ts` — 4 tests: fires on new SC 13D, fires on new SC 13G, short-seller list reverses direction to -1, respects cursor.
- `src/__tests__/trigger-sec-8-k.test.ts` — 7 tests: one per Item code (1.01, 1.02, 2.01, 2.03, 4.02, 5.02) + item 4.02 forces direction=-1.

### T-GT10 Congressional trade
- `src/lib/raw-signals/integrations/congress-trade.ts` — new adapter. Polls two sources:
  - House: `https://disclosures-clerk.house.gov/FinancialDisclosure` (HTML + ZIP of filings)
  - Senate: `https://efdsearch.senate.gov/search/` (HTML search + download)
  - Uses Senate's public JSON feed where available; falls back to HTML parsing.
- `src/lib/gap-score/triggers/ground-truth/congressional-trade.ts` — replaces stub. Uses new adapter + entity resolver.
- `src/lib/gap-score/triggers/ground-truth/congress-committee-map.ts` — static mapping of Congressional committees to sectors (for "committee with sector jurisdiction" elevation condition). ~30 committees × sector tags. Hand-curated JSON.
- `src/__tests__/congress-trade-adapter.test.ts` — 4 tests: House PTR parser, Senate EFD parser, amount-bucket parser ($1K–$15K, $15K–$50K, $50K–$100K, $100K–$250K, etc.), date extraction.
- `src/__tests__/trigger-congressional-trade.test.ts` — 5 tests: fires on tracked ticker, unmatched ticker cost-logs, elevation on >$50K, elevation on 2+ members 30d, elevation on committee match.

### Consensus scrapers
- `src/lib/macro/consensus/investing-calendar.ts` — Investing.com economic calendar scraper. Exports `scrapeUpcomingReleases(windowHours=24)` and `scrapeReleaseConsensus(indicatorSlug, date)`.
- `src/lib/macro/consensus/trading-economics-calendar.ts` — fallback scraper, same interface.
- `src/lib/macro/consensus/indicator-slug-map.ts` — maps our internal `MacroIndicatorConfig.indicator` IDs (e.g., `PAYEMS`, `CPIAUCSL`) to Investing.com slugs (e.g., `nonfarm-payrolls-227`) and Trading Economics slugs. Hand-curated JSON for the ~20 seeded indicators.
- `src/lib/macro/consensus/upsert.ts` — writes `consensusValue`, `consensusSource`, `consensusScraped` to `MacroRelease` row for matching indicator+releaseDate. Creates the row if it doesn't exist yet (release is scheduled but actual hasn't posted).
- `src/__tests__/consensus-investing-scraper.test.ts` — 5 tests: parse calendar HTML, extract consensus number with unit, handle missing consensus, handle revised-prior column, timezone conversion.
- `src/__tests__/consensus-trading-economics-scraper.test.ts` — 4 tests similar.
- `src/__tests__/consensus-upsert.test.ts` — 4 tests: creates new `MacroRelease`, updates existing row, records source, idempotent repeat.

### Consensus scheduler
- `pipeline-service/consensus-scraper-worker.ts` — new worker entry. Listens on new queue (see Ambiguity #3) or reuses `TRIGGER_SCAN`. Registers a scheduler that runs every 30 min, queries upcoming releases in next 4h, scrapes each, writes consensus. Graceful failure per release — one broken scraper doesn't kill the batch.

### Schema additions
- `prisma/schema.prisma` changes:
  - `RawSignalLayer.storyClusterId` → nullable; add `entityId String?` + relation to `TrackedEntity`.
  - `RawSignalQueue.storyClusterId` → nullable; add `entityId String?` + relation.
  - New `model TriggerCursor { id, triggerId, cursorType, cursorValue, updatedAt }` — small table, one row per cursor type per trigger.
  - Reverse relation on `TrackedEntity` for `rawSignalLayers` and `rawSignalQueueItems`.
- Migration name: `phase_1c_2a_entity_linked_signals_plus_cursor`.

### Tech debt — EIA narrowing + treasury recategorization + 20th forex
- `src/lib/historical-data/eia-client.ts`: narrow `EIA_CRUDE` query. Propose adding `facets[process][]=SAX` (stocks at tank farms and pipelines, excluding SPR, Alaska in transit) — kills duplicate series returned by current filter. (If SAX doesn't yield one series, I'll iterate with the EIA docs and report back before committing.)
- `src/lib/entities/sources/futures.ts`: treasury futures (ZB, ZN, ZT, ZF) recategorized from `category: 'fx'` → `category: 'yield'`. Keep existing `subcategory: 'treasury'`. See Ambiguity #5 — I'd rather confirm than guess whether they belong under `yield` (rate-sensitive instrument) or need a new `futures_rates` category.
- `src/lib/entities/types.ts`: widen `category` union to include `yield` if not already (currently only forex/ETF/equity/commodity/crypto/fx).
- `src/lib/entities/sources/forex.ts`: add 20th pair. I'd pick `USD/SGD` — Singapore dollar is tied to a basket, so its moves are cleaner signal than USD/HKD which is a hard peg. Flag-check Ambiguity #6.
- `src/__tests__/entity-sources-forex.test.ts` — update pair count assertion 19 → 20.
- `src/__tests__/entity-sources-futures.test.ts` — update category assertions for Treasury futures.
- Re-run `seed-entities.ts` on dev Supabase. New TrackedEntity count: ~11,235 (net +1 forex; treasury move is recategorization only).
- `scripts/seed-macro-config.ts` or successor: rerun if EIA_CRUDE narrowing affects the `historicalStddev` proxy. Likely just a data reload — verify the ~520 EIA release count is preserved post-narrow.

---

## Files to modify

### Adapter refactor surface
- `src/lib/raw-signals/runner.ts`: make `storyClusterId` in `RunnerContext` nullable, add optional `entity?: { id, identifier, name, aliases }`. Cluster lookup only runs when `storyClusterId` is present. Persistence writes `entityId` when present. Backward-compatible: all existing callers keep passing `storyClusterId`.
- `src/lib/raw-signals/integrations/sec-edgar.ts`: extract HTTP fetcher into `clients/sec-edgar-client.ts`; the adapter itself becomes a thin wrapper that adds cluster-context Haiku assessment. Functionality unchanged for legacy callers.
- `src/lib/raw-signals/integrations/index.ts`: register `congress-trade` adapter.

### Trigger registry + worker
- `src/lib/gap-score/triggers/registry.ts`: no changes required (T-GT1/2/3/10 already registered).
- `pipeline-service/candidate-generator-worker.ts`: no changes to the 4 existing trigger cadences. Add consensus-scraper scheduler if not using a separate worker.

### Admin navigation (minor)
- `src/app/admin/layout.tsx`: **no change in 1c.2a.** The `/admin/triggers` link lands in 1c.2b with the UI.

---

## Expected test delta

Current baseline: 635 tests across 49 files.

**Added:** 45 tests across 11 new test files.

| File | Test count |
|---|---|
| `sec-edgar-client.test.ts` | 6 |
| `trigger-sec-form-4.test.ts` | 6 |
| `trigger-sec-13d-g.test.ts` | 4 |
| `trigger-sec-8-k.test.ts` | 7 |
| `congress-trade-adapter.test.ts` | 4 |
| `trigger-congressional-trade.test.ts` | 5 |
| `consensus-investing-scraper.test.ts` | 5 |
| `consensus-trading-economics-scraper.test.ts` | 4 |
| `consensus-upsert.test.ts` | 4 |

**Modified:** 2 existing files gain/change ~3 assertions.

**Expected post-phase:** ~680 tests across 60 files. (Exact count will vary by ±5 depending on edge-case shakeout.)

---

## Ambiguities — need your decision before I execute

**1. Raw signal persistence for trigger-driven fetches.**
When T-GT1 polls EDGAR and finds a $5M insider sale, do we write a `RawSignalLayer` row for that filing (forensic trail), or only emit the `TriggerEvent` and store the filing payload inside `TriggerEvent.metadata`? The former gives us a clean case-study evidence library; the latter is simpler and avoids dual-write complexity. My default: **only TriggerEvent, filing payload in metadata**. RawSignalLayer stays for cluster-scoped legacy runs. I'll switch to dual-write if you want the forensic trail.

**2. SEC EDGAR cursor granularity.**
Options: (a) one cursor per form-type per trigger (4 cursors total), (b) one cursor per trigger (3 cursors), (c) one cursor globally for all SEC polling. I prefer (b) — simpler, and re-processing a filing across multiple triggers is fine since each trigger has its own dedupe logic via `TriggerEvent` uniqueness.

**3. Consensus scraper queue topology.**
Options: (a) add new queue `macro-consensus-scrape` to `QUEUE_NAMES`, dedicated worker; (b) reuse existing `TRIGGER_SCAN` queue with a special `triggerId` convention. (a) is cleaner separation; (b) is less scaffolding. I lean (a) since consensus scraping has different retry semantics (long backoff on HTML scraper failures vs. instant retry on trigger errors).

**4. Congressional trade data source pricing.**
House + Senate public disclosures are free but the HTML is notoriously messy. Commercial aggregators (Capitol Trades, Quiver Quantitative) offer clean JSON for $50–200/mo. My default: **ship with free HTML scraping for 1c.2a, flag commercial upgrade as 1c.2b follow-up if HTML scraper needs repeated maintenance**. If you want to budget the commercial feed now, tell me and I'll spec the integration instead.

**5. Treasury-futures category.**
`yield` (per existing FRED yields) or new `futures_rates` (distinguishes rate futures from rate series)? My default: **use `yield`**. Downstream trigger functions that treat yields as "rate-sensitive fixed income" work the same way for DGS10 and ZN. If you want separation so Phase 11 paper-trading routes them to different strategies, new category is cleaner.

**6. 20th forex pair.**
USD/SGD (my pick — MAS manages basket, gives us real signal) or USD/HKD (hard-pegged, only moves when the peg is under stress, rare but high-signal when it does)? Happy either way.

**7. EIA_CRUDE narrowing acceptance criteria.**
If `facets[process][]=SAX` doesn't collapse to one series, should I (a) iterate until I find the right filter combo and commit once, (b) commit whatever narrows it "best" and flag residual duplicates, or (c) punt to 1c.2b if the first attempt fails? My default: (a) — this is a 30-minute investigation, not worth deferring.

**8. Runner `RunnerContext.cluster` field shape when entity-scoped.**
When runner is invoked with `entity` + no `storyClusterId`, the existing `cluster: {id, headline, synopsis, entities, ...}` field has no meaning. Options: (a) make `cluster` optional in the `RunnerContext` type (type churn across all 40+ adapters), (b) synthesize a "pseudo-cluster" from the entity (`{id: entity.id, headline: entity.name, entities: [entity.identifier]}`), (c) introduce a `RunnerContextV2` union type. My default: (a), narrow-scope the TS changes to only affect the runner + the 1c.2 adapters. Legacy adapters keep working via structural typing.

---

## Pre-execution verification gates

- Capture baseline: `npm test` → record exact count. Expect 635.
- `npx tsc --noEmit` → zero errors.
- `npx prisma validate` → zero errors.
- Migration generated but NOT applied until manifest approval.

## Post-execution verification gates (before branch merge)

- `npm test` → 680 ± 5, zero failures, zero skips.
- `npx tsc --noEmit` → zero errors.
- `npx prisma migrate deploy` on dev Supabase; verify row counts preserved (1,572 `MacroRelease`, 172 `ZoneBaseline`, TrackedEntity = 11,234 pre-20th-forex, 11,235 post).
- Manual smoke: queue consensus scrape job for next NFP/CPI date, verify `MacroRelease.consensusValue` populates. Verify T-GT9 fires on a backfilled dev row.
- Manual smoke: trigger T-GT1/2/3 scans, verify at least one real filing gets resolved to a `TrackedEntity` and emits a `TriggerEvent` with correct severity.
- Manual smoke: one congressional PTR filing resolved to TrackedEntity, one unresolved → `CostLog` row confirmed present.
- Run pipeline isolated: `npm run queues:status` (or equivalent) to confirm all schedulers registered.

## Git hygiene

- Branch: `pivot/phase-1c-2a-foundation` off `main` @ 8f81445.
- Commits: one per file group (refactor, SEC triggers, congress, consensus, tech debt). ~6–8 commits.
- Final push to origin at manifest verification gates pass, not per-commit.

---

## Phase 1c.2b — preview (not executed in this pass)

**Scope:**
- Narrative triggers T-N1..T-N4 + GDELT/RSS adapter refactor to write to `TrackedEntity` (requires the adapter-refactor foundation from 1c.2a).
- Psychological triggers T-P1..T-P4 + Twitter/Reddit adapter refactor.
- T-GT4 CFTC COT (new integration — weekly Friday cron).
- T-GT5/T-GT6 price moves (new Yahoo Finance or Alpha Vantage client; picking one is the first decision in 1c.2b).
- T-GT7 Maritime AIS (wire existing Datalastic adapter into zone-aware trigger, gate on `ZoneBaseline.isMature`).
- T-GT8 Commodity inventory (wire EIA/USDA; USDA stays stubbed).
- T-GT11 Earnings transcripts (new integration — pick provider within $50–100/mo budget; **key decision to flag at start of 1c.2b**).
- Admin trigger-tuning UI at `/admin/triggers` + `TriggerEnablement` DB table to replace env-var gating.

**Estimated effort:** 6–7 hours after 1c.2a lands.

**Value gating:** T-GT4/GT7/GT8 fire immediately on real data. T-GT5/GT6 fire after 25 trading days of price data. T-N1/N2/P1/P2 fire after 7–18 days of baseline accumulation. Plan accordingly — 1c.2b "ships" triggers that will actively fire over the subsequent 3 weeks.

---

## Decision needed from you

1. Accept phase split (1c.2a foundation + 1c.2b long tail), or keep as one phase?
2. Answers to the 8 ambiguities above (or "go with your defaults" is fine).
3. Green-light to proceed on 1c.2a as scoped.
