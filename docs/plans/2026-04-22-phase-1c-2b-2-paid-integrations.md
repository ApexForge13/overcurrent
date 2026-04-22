# Phase 1c.2b.2 Planned Changes Manifest — paid integrations + admin UI

> **Status:** Planning. Not approved for execution.
> **Branch (on approval):** `pivot/phase-1c-2b-2-paid-integrations` off `main` @ d512d83 (effective: e750ca7 after verify-script chore).
> **Depends on:** Phase 1c.2b.1 merged (migration applied, narrative/psych stream + CFTC live).

## Scope at a glance

7 deliverables, all ending Phase 1c's new-capability work:
1. **Polygon client + T-GT5/T-GT6/T-GT12** — price moves, overnight gaps, unusual options flow. Key-gated.
2. **Data Docked zone scanner + T-GT7** — maritime anomaly per Tier-1 zone. Double-gated (key + DATADOCKED_SCANNING_ENABLED).
3. **T-GT8 commodity inventory** — wire existing EIA/USDA historical data to trigger logic.
4. **DCF earnings adapter + T-GT11** — transcript availability. Key-gated, queue-only (no Haiku scoring).
5. **T-N2 quiet-period guard** — deferred from 1c.2b.1; earnings + FOMC calendar check.
6. **Admin trigger UI at `/admin/triggers`** + new `TriggerEnablement` DB table.
7. **MonitoringZone.scanTier** — tier field on the code-level zone registry (not DB — see Ambiguity #1).

**No further split recommended.** This fits ~6-7 hours in a single phase. M1-M7 are integration work; M8 is UI. If partway through execution I see scope creep, I'll flag a stop and re-propose.

---

## Goal

Ship the last block of Phase 1c — every trigger from the Phase 1 spec addendum is either wired-and-firing or gated-with-clear-reason. Admin UI gives ops visibility + control before Phase 2 (Gap Score computation) turns TriggerEvent rows into the product.

## Architecture

- **Polygon path** follows the SEC EDGAR pattern from 1c.2a: extract HTTP layer into `src/lib/raw-signals/clients/polygon-client.ts` so legacy adapter + new triggers share it without coupling. Add endpoints for daily bars (`/v2/aggs/ticker/:t/prev`), snapshot (`/v2/snapshot/locale/us/markets/stocks/tickers/:t`), options chain unusual activity (`/v3/snapshot/options/:underlying` at Business tier).
- **Data Docked path** reuses existing cluster-scoped adapter's `datadockedFetch` helper with a new `pollZones(zones, tier)` entry point. Gated by both DATADOCKED_API_KEY and DATADOCKED_SCANNING_ENABLED; missing either → heartbeat + skip. Uses get-vessels-by-area (10 credits) per zone; never port-calls-by-port (50 credits prohibitive per manifest).
- **T-GT8 inventory** piggybacks on `MacroRelease` + `MacroIndicatorConfig.historicalStddev` already loaded in Phase 1b. Scans the past 48h for EIA + USDA releases with `surpriseZscore` computed; fires when |z| > 1.0. Direction from `MacroIndicatorConfig.directionMapping` (existing field).
- **DCF adapter** polls the earnings-transcripts endpoint, resolves ticker → TrackedEntity, emits T-GT11 fires with `severity=0.7` per spec. Transcript body stored in `TriggerEvent.metadata.transcript_preview` (first 2000 chars) + full URL; Phase 2 Haiku scoring consumes later.
- **T-N2 quiet-period guard** queries `MacroRelease` (FOMC dates within 24h) and a new `EarningsSchedule` table (next 14 days of tracked-ticker earnings from DCF). Hook wired during M6 after DCF lands.
- **Admin UI** uses the existing `AdminLayout` gate + Next 14 App Router server components. One page (`src/app/admin/triggers/page.tsx`) + one API route per mutation (`src/app/api/admin/triggers/[triggerId]/toggle/route.ts`, `.../thresholds/route.ts`). DB-backed `TriggerEnablement` replaces env-var `isTriggerEnabled()` with a DB-overrides-env fallback chain.

**Tech Stack:** no new runtime deps. React components use existing Tailwind theme tokens. Prisma 7, Next.js 16 App Router, BullMQ 5.

**Estimated effort:** 6-7 hours.

---

## Files to create

### Schema + migration
- `prisma/migrations/PHASE1C2B2_trigger_enablement_plus_earnings_schedule.sql` — hand-written additive SQL.
- `prisma/schema.prisma`: two new models.
  - `TriggerEnablement` — `(triggerId, enabled, thresholdOverrides, updatedAt, updatedBy)`. Unique on triggerId.
  - `EarningsSchedule` — `(entityId, ticker, reportDate, timeOfDay, confirmed, scrapedAt)`. Unique on (entityId, reportDate). Populated by DCF poller.

### Polygon client + price triggers
- `src/lib/raw-signals/clients/polygon-client.ts` — new shared client. Exports `fetchDailyBar`, `fetchSnapshot`, `fetchUnusualOptionsActivity`. Handles 401/403/429/5xx routing into `PolygonFetchOutcome` union. Rate-limiter wrapper using existing `src/lib/rate-limit.ts` buckets (100 req/min on Starter tier per Polygon's documented cap; 1000/min on Business for options flow).
- `src/lib/raw-signals/integrations/polygon.ts` — **modify** (not rewrite). Extract HTTP helpers → client. Legacy cluster-adapter behavior preserved; all existing polygon tests must pass unchanged.
- `src/lib/gap-score/triggers/ground-truth/price-baseline-worker.ts` — computes 30-day realized volatility per tracked entity from Polygon daily-bar history. Stores in `EntityBaseline` with `metricName='realized_vol_30d'`, `windowDays=30`, `minSampleSize=25`. Scheduled nightly via `gap-score-baseline-compute` queue.
- `src/lib/gap-score/triggers/ground-truth/price-entity-resolver.ts` — feeds entity list to Polygon (all active equity + ETF + commodity TrackedEntity rows). Featured-set prioritized for intraday.
- `src/lib/gap-score/triggers/ground-truth/price-intraday-move.ts` — T-GT5. Reads snapshot, compares to prev close + realized vol baseline. Fires when `|move_pct|` exceeds category threshold (Equity 3%, Commodity 2%, Crypto 5%); severity = `|move| / realized_vol`, cap 1.0.
- `src/lib/gap-score/triggers/ground-truth/price-overnight-gap.ts` — T-GT6. Daily bar open vs prior close. Thresholds 2%/1%/4% per category.
- `src/lib/gap-score/triggers/ground-truth/options-flow-unusual.ts` — T-GT12. Pulls unusual options activity from Polygon Business endpoint (gated by TIER env — see Ambiguity #2). Severity by volume ratio vs open interest.

### Data Docked zone scanner + T-GT7
- `src/lib/raw-signals/clients/datadocked-client.ts` — extract HTTP helper from existing `datadockedFetch`. Exports `fetchVesselsByArea(bbox)`, `fetchVesselLocation(mmsi)`.
- `src/lib/gap-score/zones/tier-1-zones.ts`: **modify** — add `scanTier: 1 | 2 | 3` field on each zone. Default all 43 zones to `scanTier: 1` initially; user can rebalance post-deploy. (See Ambiguity #1 — zones stay TS-only in my default.)
- `src/lib/gap-score/triggers/ground-truth/maritime-zone-scanner.ts` — per-zone polling loop. Checks DATADOCKED_API_KEY + DATADOCKED_SCANNING_ENABLED; emits heartbeat + returns [] if either missing. Calls `fetchVesselsByArea` per zone, counts tankers/cargo/etc., updates `ZoneBaseline.sampleCount`, flags maturity.
- `src/lib/gap-score/triggers/ground-truth/maritime-anomaly.ts` — T-GT7. Reads latest zone observations, compares to `ZoneBaseline` (must be mature — `sampleCount >= 90`). Fires when |z| > 2 per metric (tankerCount, containerShipCount, bulkCarrierCount, lngCarrierCount). Direction from zone classifier (per tier-1-zones.ts).

### T-GT8 commodity inventory
- `src/lib/gap-score/triggers/ground-truth/commodity-inventory.ts` — T-GT8. Queries `MacroRelease` for EIA_CRUDE, EIA_NATGAS, USDA_* releases in past 48h with `actualValue != null AND consensusValue != null AND surpriseZscore != null`. Fires when `|surpriseZscore| > 1.0`. Severity = `|z| / 3`, cap 1.0. Direction from `MacroIndicatorConfig.directionMapping` per relevant asset (already populated). USDA releases pass through the same filter; returns 0 fires until USDA data actually flows (manifest note — USDA stub).

### DCF earnings + T-GT11
- `src/lib/raw-signals/clients/dcf-client.ts` — new. Exports `fetchRecentTranscripts(limit, since)` hitting `discountingcashflows.com/api/transcripts` (adjust per actual DCF API docs before first live call; spec-based stubs for now).
- `src/lib/gap-score/triggers/ground-truth/earnings-transcript.ts` — T-GT11. Polls DCF every 2h, resolves ticker → TrackedEntity, persists 2000-char preview + URL to `TriggerEvent.metadata`. Cursor on `transcript_id`. Severity 0.7, direction 0 (Phase 2 Haiku fills). Dedup via TriggerCursor.
- Populates `EarningsSchedule` as a side effect — future transcripts we've seen scheduled become the T-N2 quiet-period guard's data source.

### T-N2 quiet-period guard
- `src/lib/gap-score/triggers/narrative/quiet-period-calendar.ts` — helper. Returns `{ inFomcQuietPeriod: boolean; inEarningsQuietPeriod: (entityId) => boolean }` for a given timestamp. FOMC dates hardcoded as a frozen array (next 12 months; see Ambiguity #7). Earnings from `EarningsSchedule`.
- `src/lib/gap-score/triggers/narrative/cross-outlet.ts`: **modify** — import quiet-period helper, skip emitting fires for entities in their quiet period. Metadata records `quiet_period_suppressed: entityId[]` for observability.

### Admin UI + TriggerEnablement
- `src/lib/gap-score/triggers/enablement.ts` — new module replacing the env-var-only `isTriggerEnabled()`. Chain: DB row (if exists) → env var → conservative default. Cache with 60s TTL to avoid per-scan DB hit. Exports `isTriggerEnabledWithFallback(triggerId, env?)` + `getThresholdOverrides(triggerId): Record<string, number> | null`.
- `src/lib/gap-score/triggers/dispatch.ts`: **modify** — replace `isTriggerEnabled` import with `isTriggerEnabledWithFallback`. Read thresholdOverrides and pass into TriggerContext.
- `src/lib/gap-score/triggers/types.ts`: **modify** — add `thresholds?: Record<string, number>` to TriggerContext.
- `src/lib/gap-score/triggers/firing-stats.ts` — single `$queryRawUnsafe` with CTE returning `{triggerId, fires24h, fires7d, fires30d, lastFiredAt}` for all triggers in one roundtrip.
- `src/lib/gap-score/triggers/baseline-status.ts` — returns `{entityId, identifier, metricName, windowDays, sampleCount, minSampleSize, isMature}` + `{zoneId, metricName, ...}` sorted by (isMature asc, sampleCount desc) for UI display.
- `src/app/admin/triggers/page.tsx` — server component. Fetches all triggers + firing stats + enablement rows + baseline status + returns JSX.
- `src/app/admin/triggers/TriggerToggle.tsx` — client component for the enable/disable switch.
- `src/app/admin/triggers/ThresholdEditor.tsx` — client component modal (JSON textarea with validation). On save POSTs to API.
- `src/app/api/admin/triggers/[triggerId]/toggle/route.ts` — POST handler. `requireAdmin()` gate, body `{ enabled: boolean }`, upserts `TriggerEnablement` with updatedBy=email.
- `src/app/api/admin/triggers/[triggerId]/thresholds/route.ts` — POST. Same gate; body `{ thresholdOverrides: object | null }`, validates JSON, upserts.
- `src/app/admin/layout.tsx`: **modify** — add nav link `<a href="/admin/triggers" className="...">Triggers</a>` in the horizontal admin nav.

### Tests
- `src/__tests__/polygon-client.test.ts` — 6 tests (fetchDailyBar, fetchSnapshot, unusual options, 401/429, parse errors).
- `src/__tests__/trigger-t-gt5-intraday-move.test.ts` — 6 tests (fire + thresholds per category + realized-vol severity + immature baseline).
- `src/__tests__/trigger-t-gt6-overnight-gap.test.ts` — 4 tests.
- `src/__tests__/trigger-t-gt12-options-flow.test.ts` — 5 tests (fire, severity by ratio, gated without key, rate-limit respect).
- `src/__tests__/price-baseline-worker.test.ts` — 4 tests (rolling 30d vol compute, maturity flip at 25 bars, isMature=false until 25, degenerate-series handling).
- `src/__tests__/datadocked-client.test.ts` — 4 tests (fetchVesselsByArea + fetchVesselLocation + error routing).
- `src/__tests__/maritime-zone-scanner.test.ts` — 5 tests (double-gate check, zone-tier cadence, baseline update, heartbeat missing-key, heartbeat flag-off).
- `src/__tests__/trigger-t-gt7-maritime-anomaly.test.ts` — 5 tests (z-fire, immature zone skip, direction by zone category, dedup).
- `src/__tests__/trigger-t-gt8-commodity-inventory.test.ts` — 6 tests (EIA crude fire, EIA natgas fire, USDA 0-fire stub, direction map, consensus-null skip, subthreshold skip).
- `src/__tests__/dcf-client.test.ts` — 4 tests (fetch recent, parse, 401/429, empty).
- `src/__tests__/trigger-t-gt11-earnings-transcript.test.ts` — 5 tests (fire on new transcript, cursor advance, ticker unresolved log, dedup, 0.7 severity).
- `src/__tests__/quiet-period-calendar.test.ts` — 5 tests (FOMC in window, not-in window, earnings in window, not-in window, helper composition).
- `src/__tests__/trigger-t-n2-cross-outlet-quiet-period.test.ts` — extend existing T-N2 file with 3 additional tests for quiet-period suppression.
- `src/__tests__/trigger-enablement.test.ts` — 6 tests (DB override, env fallback, conservative prod default, cache TTL, threshold overrides, enablement-missing fallback).
- `src/__tests__/trigger-firing-stats.test.ts` — 3 tests (all triggers returned, window counts correct, empty table zero counts).
- `src/__tests__/admin-triggers-api.test.ts` — 4 tests (toggle route, thresholds route, admin-gate rejection, invalid body rejection).

---

## Files to modify

- `prisma/schema.prisma` — TriggerEnablement + EarningsSchedule.
- `src/lib/gap-score/zones/tier-1-zones.ts` — scanTier field on MonitoringZone.
- `src/lib/raw-signals/integrations/polygon.ts` — extract to client, slim down (existing cluster-scoped logic preserved via client calls).
- `src/lib/gap-score/triggers/dispatch.ts` — enablement lookup + threshold injection.
- `src/lib/gap-score/triggers/types.ts` — optional thresholds on TriggerContext.
- `src/lib/gap-score/triggers/registry.ts` — 4 new entries (T-GT5, T-GT6, T-GT7, T-GT8, T-GT11, T-GT12).
- `pipeline-service/candidate-generator-worker.ts` — register 6 new triggers + schedulers:
  - T-GT5 every 15 min (intraday requires frequent scans)
  - T-GT6 daily at market open (14:00 UTC ~09:00 ET pre-market)
  - T-GT7 per-zone at tier cadence (Tier 1: 2x/day, Tier 2: 1x/day, Tier 3: 0.5x/day)
  - T-GT8 every 30 min
  - T-GT11 every 2h
  - T-GT12 every 30 min (rate-limit sensitive)
- `src/lib/gap-score/triggers/narrative/cross-outlet.ts` — quiet-period guard.
- `src/app/admin/layout.tsx` — nav link.
- `src/__tests__/queue-names.test.ts` — no change (no new queues needed; reuse `trigger-scan` + `gap-score-baseline-compute`).
- `src/__tests__/trigger-registry.test.ts` — count 16 → 22 triggers; assertions updated.
- `src/__tests__/raw-signals-polygon.test.ts` — verify legacy behavior preserved after extraction.

**No changes to:** 1c.2b.1 narrative/psych code, 1c.2a SEC/Congress triggers, macro-surprise trigger, entity extraction, existing migrations.

---

## Expected test delta

Current: 804. **Added:** ~95 across 16 files. **Expected post-phase: ~895-905.** Matches user estimate.

---

## Ambiguities — need your decision

**1. MonitoringZone: TS field or DB model?**
The manifest scope said "add scanTier column to MonitoringZone (add migration)". MonitoringZone currently lives in `src/lib/gap-score/zones/tier-1-zones.ts` as a frozen TypeScript array. No DB table.

Options:
- **(a) TS-only field** — add `scanTier: 1 | 2 | 3` to the interface + assign values in the frozen array. Zero migration. Zones change → edit TS. (My default.)
- **(b) Create `MonitoringZone` DB model** — seed script populates from the TS array. Admin UI could then edit tiering without code push. Big lift for 1c.2b.2: new model + seed + query integration in T-GT7 + admin UI addition for zone tier editing.

(a) is faster; (b) is cleaner long-term if you want zone tiering editable without deploys. My default is (a) — defer (b) to a future phase if/when ops actually rebalances tiers regularly.

**2. Polygon Business tier for T-GT12.**
The options unusual-activity endpoint is Polygon Business tier ($199/mo), not Starter ($29/mo). Your current subscription target isn't stated. Options:
- **(a) Build T-GT12 against Business endpoint spec; gate with `POLYGON_TIER === 'business'` env check.** Works on Starter key with heartbeat `options_tier_required`. Upgrade to Business later with zero code change. (My default.)
- **(b) Skip T-GT12 in 1c.2b.2** and defer entirely.

**3. TriggerEnablement fallback chain.**
- **(a) DB overrides env, falls back to env if no DB row, conservative prod default if neither.** (My default — safest migration; existing env-var-configured triggers keep working without manual DB seeding.)
- **(b) Hard cutover — DB only.** Migration seeds all 22 triggers; `isTriggerEnabled()` ignores env.

**4. Threshold override mechanism.**
`TriggerEnablement.thresholdOverrides` is JSON. Schema varies per trigger (T-N1 has `Z_FLOOR` + `ABSOLUTE_FLOOR`; T-GT5 has per-category `equity_pct` + `commodity_pct` + `crypto_pct`; etc.).
- **(a) Free-form JSON, trigger functions merge with defaults.** (My default — simplest, triggers with typo'd keys just use defaults.)
- **(b) Typed per-trigger schemas, validated on write.** More code, but admin UI can render safer forms.

**5. DCF provider.**
`DCF_API_KEY` per the scope. Confirm target is [discountingcashflows.com](https://discountingcashflows.com/)? Their earnings-transcripts endpoint shape isn't identical to Seeking Alpha or similar. My default is to build against `https://discountingcashflows.com/api/v1/transcripts/{ticker}/latest` — but this assumes the API is actually stable there. Worth confirming before the client code lands.

**6. T-GT8 USDA stub.**
USDA data is loaded into `MacroRelease` from Phase 1b but without consensus scraping. The trigger's surprise computation needs both `actualValue` and `consensusValue`. For USDA releases with null consensus, T-GT8 simply won't fire — which matches the user's "returns 0 fires until USDA integration lands" direction. No special handling needed; trigger naturally skips. I'll note in code + commit that this is the intentional stub state.

**7. FOMC calendar source.**
Options:
- **(a) Hardcoded frozen array of next 12 FOMC meeting dates.** (My default. 8 meetings/year; low maintenance. Update annually.)
- **(b) Scrape from Fed website.** More work; FOMC schedule is published 12+ months ahead anyway, so scrape overkill.

**8. DCF transcript body storage.**
Transcripts are 30-50KB each. Options:
- **(a) Store first 2000 chars in `TriggerEvent.metadata.transcript_preview` + full URL.** Keeps TriggerEvent rows lean; Phase 2 Haiku fetches full text from DCF URL when needed. (My default.)
- **(b) Full transcript in metadata.** Fatter rows, but no second fetch round-trip during Haiku scoring.

---

## Pre-execution verification gates

- Baseline: `npm test` → 804.
- `npx tsc --noEmit` → 0.
- `npx prisma validate` → 0.
- Migration generated but NOT applied.

## Post-execution verification gates

- `npm test` → ~895-905 (±10), zero failures.
- `npx tsc --noEmit` → 0.
- `npx next build` → exit 0.
- Manual: visit `/admin/triggers` on dev (authed as admin), verify table renders all 22 triggers with firing stats = 0 (baselines just starting). Toggle one trigger off, verify DB write + cache invalidation. Edit a threshold override, verify JSON validation.
- Manual: trigger T-GT8 scan, verify 0 fires while no consensus data exists, then backfill one consensus row and re-scan → expect 1 fire.

## Git hygiene

- Branch: `pivot/phase-1c-2b-2-paid-integrations` off main.
- Commits per milestone, ~8-10 total.
- Push to origin once all verification gates pass.

---

## Milestone breakdown

| # | Milestone | Est | Test delta |
|---|---|---:|---:|
| M1 | Schema migration (TriggerEnablement, EarningsSchedule) + scanTier on zones | 30 min | +0 |
| M2 | Polygon client extract + T-GT5 + T-GT6 + price baseline worker | 75 min | ~20 |
| M3 | T-GT12 options flow | 30 min | ~5 |
| M4 | Data Docked zone scanner + T-GT7 + scanTier logic | 90 min | ~14 |
| M5 | T-GT8 inventory wiring | 30 min | ~6 |
| M6 | DCF client + T-GT11 + EarningsSchedule population | 75 min | ~9 |
| M7 | T-N2 quiet-period guard | 30 min | ~8 |
| M8 | Admin UI + TriggerEnablement + API routes | 120 min | ~33 |
| | **Total** | **~6.5h** | **~95** |

---

## Decisions needed from you

1. Ambiguity answers (all 8) — or "defaults are fine".
2. Green-light to execute 1c.2b.2 as scoped.
3. Any provisioning updates on POLYGON / DCF / DATADOCKED keys that would affect gating? (Current assumption: all three absent → integrations ship dormant; keys flip each trigger on individually.)
