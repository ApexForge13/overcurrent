# 2026-04-21 — Phase 1c Amendment: Forex + Sovereign Yield Entity Coverage

> **Status:** Planning amendment — extends Phase 1c kickoff scope.
> **When to apply:** At Phase 1c kickoff, fold this scope into the manifest alongside the trigger functions / consensus scrapers / candidate generator work already planned.
> **Does not replace:** The Phase 1c scope in the v2 master prompt (trigger framework, consensus scrapers, candidate generator) and the Phase 1 trigger addendum ([2026-04-21-phase-1-trigger-addendum.md](2026-04-21-phase-1-trigger-addendum.md)). This amendment adds entity-registry coverage that belongs in Phase 1c rather than Phase 1b because the direction-map seeds reference trigger IDs that Phase 1c will define.
>
> Rationale: Phase 1b landed ~11,089 entities (SEC + CoinGecko top-1K + 40 hardcoded futures + 49 hardcoded ETFs). Forex pairs and sovereign yields weren't in Phase 1b because (a) they have no natural API source the other categories use, (b) the direction mappings bind tightly to macro triggers that land in 1c, and (c) the list is small and stable enough to hardcode once alongside the triggers that reference it.
>
> Post-amendment entity target: ~11,117 = 11,089 (Phase 1b) + 20 forex + 8 sovereign yields.

---

## Additional scope for Phase 1c

### New source file: `src/lib/entities/sources/forex.ts`

Hardcoded catalog of ~20 currency pairs. Follows the same `TrackedEntityInput` shape as `futures.ts` and `etfs.ts`. Category: `fx`.

**G10 majors (7):**
- `EUR/USD` — Euro / US Dollar
- `USD/JPY` — US Dollar / Japanese Yen
- `GBP/USD` — British Pound / US Dollar
- `USD/CHF` — US Dollar / Swiss Franc
- `AUD/USD` — Australian Dollar / US Dollar
- `USD/CAD` — US Dollar / Canadian Dollar
- `NZD/USD` — New Zealand Dollar / US Dollar

**Crosses (4):**
- `EUR/JPY` — Euro / Japanese Yen
- `EUR/GBP` — Euro / British Pound
- `GBP/JPY` — British Pound / Japanese Yen
- `AUD/JPY` — Australian Dollar / Japanese Yen

**Emerging markets (6):**
- `USD/CNY` — US Dollar / Chinese Yuan
- `USD/INR` — US Dollar / Indian Rupee
- `USD/BRL` — US Dollar / Brazilian Real
- `USD/MXN` — US Dollar / Mexican Peso
- `USD/ZAR` — US Dollar / South African Rand
- `USD/TRY` — US Dollar / Turkish Lira

**Precious metals (technically forex, priced in USD) (2):**
- `XAU/USD` — Gold / US Dollar (spot)
- `XAG/USD` — Silver / US Dollar (spot)

**Provider IDs to populate:**
- `cryptoSymbol`: null (these are forex)
- Add a new `providerIds.fxSymbol` convention (no-slash form for matching: `EURUSD`, `USDJPY`, etc.)
- `entityStrings.aliases`: include both slash and no-slash forms + common names ("Euro", "Cable" for GBP/USD, etc.)

**Applicable triggers for forex:** `T-GT5` (intraday move), `T-GT6` (overnight gap), `T-GT9` (macro surprise). Not `T-GT1/2/3/10/11` (no SEC filings for currencies) or `T-GT4/7/8` (no COT for spot FX at our granularity, no maritime zones, no inventory releases).

### New entries for existing source file: sovereign yields (5-8)

Yields live on a spectrum between equity-like and macro-like. Simplest integration: add them as TrackedEntities with `category: 'yield'` (a new category value) and hardcode in a new section of `futures.ts` OR a new file `src/lib/entities/sources/yields.ts`. Recommend the separate file — easier to extend to sovereign yields globally later.

**Target yields (8):**
- `DGS2` — US 2-Year Treasury Yield (FRED series ID)
- `DGS5` — US 5-Year Treasury Yield
- `DGS10` — US 10-Year Treasury Yield
- `DGS30` — US 30-Year Treasury Yield
- `DE10Y` — German 10-Year Bund Yield (sourced via FRED `IRLTLT01DEM156N` or similar)
- `JP10Y` — Japan 10-Year JGB Yield (sourced via FRED `IRLTLT01JPM156N`)
- `UK10Y` — UK 10-Year Gilt Yield (sourced via FRED `IRLTLT01GBM156N`)
- `IT10Y` — Italy 10-Year BTP Yield (sourced via FRED `IRLTLT01ITM156N`)

**Provider IDs:** include the FRED series ID under `providerIds.fredSeriesId` so the historical-data loader can pull yield history via the same FRED client.

**Applicable triggers for yields:** `T-GT5` (intraday move), `T-GT6` (overnight gap), `T-GT9` (macro surprise). Yields are especially sensitive to inflation + rate-policy surprises.

**Category note:** `category: 'yield'` is a new value. Update the `EntityCategory` union in `src/lib/entities/types.ts` from `'equity' | 'commodity' | 'crypto' | 'etf' | 'fx'` to add `| 'yield'`. Existing Phase 1b test `entity-featured-set` doesn't reference yields so it's unaffected.

### Direction-mapping additions to `src/lib/historical-data/direction-maps.ts`

Extend the existing `MACRO_DIRECTION_MAPS` entries for the 15 FRED indicators + 2 EIA + 3 USDA (already seeded in Phase 1b) with per-pair directions for the new forex + yield identifiers. Standard FX conventions:

**NFP positive surprise (stronger US labor) → USD strengthens:**
```typescript
PAYEMS: {
  // ... existing SPY/QQQ/TLT/GC=F mappings ...
  'EUR/USD': { positive: -1, negative: 1 },
  'USD/JPY': { positive: 1,  negative: -1 },
  'GBP/USD': { positive: -1, negative: 1 },
  'USD/CHF': { positive: 1,  negative: -1 },
  'AUD/USD': { positive: -1, negative: 1 },
  'USD/CAD': { positive: 1,  negative: -1 },
  DGS2:      { positive: 1,  negative: -1 },   // short rates rise on strong data
  DGS10:     { positive: 0.5, negative: -0.5 },
}
```

**CPI positive surprise (hot inflation) → USD strengthens on Fed hawkishness; gold hedge:**
```typescript
CPIAUCSL: {
  // ... existing mappings ...
  'EUR/USD': { positive: -1, negative: 1 },
  'USD/JPY': { positive: 1,  negative: -1 },
  'GBP/USD': { positive: -1, negative: 1 },
  'XAU/USD': { positive: 1,  negative: -1 },   // gold as inflation hedge
  DGS2:      { positive: 1,  negative: -1 },
  DGS10:     { positive: 1,  negative: -1 },
  DGS30:     { positive: 1,  negative: -1 },
}
```

**Fed rate hike surprise (higher-than-expected Fed Funds) → USD up, yields up:**
```typescript
FEDFUNDS: {
  // ... existing mappings ...
  'EUR/USD': { positive: -1, negative: 1 },
  'USD/JPY': { positive: 1,  negative: -1 },
  DGS2:      { positive: 1,  negative: -1 },
  DGS10:     { positive: 0.5, negative: -0.5 },
  'XAU/USD': { positive: -0.5, negative: 0.5 },
}
```

**Unemployment Rate positive surprise (higher unemployment = weak labor) → USD weakens (inverted):**
```typescript
UNRATE: {
  // ... existing mappings ...
  'EUR/USD': { positive: 1,  negative: -1 },
  'USD/JPY': { positive: -1, negative: 1 },
  DGS2:      { positive: -1, negative: 1 },   // short rates fall on weak data
}
```

Analogous additions for the remaining indicators (Retail Sales, Industrial Production, Housing Starts, Initial Claims [inverted], Consumer Sentiment, etc.) per standard FX convention:
- Strong US data → USD strengthens (bullish USD-numerator pairs, bearish USD-denominator)
- Weak US data → USD weakens (inverse)
- Inflation-adjacent beats → yields up, USD up, gold up, bonds down
- Employment-adjacent beats → yields up (short end), USD up

### Update the `historical-direction-maps.test.ts` regression suite

Add cases:
- Every forex pair in the 20-pair catalog appears in at least one indicator's direction map (catches missed coverage).
- For USD-numerator pairs (USD/JPY, USD/CHF, etc.), NFP positive is positive; for USD-denominator pairs (EUR/USD, GBP/USD), NFP positive is negative — this catches sign-convention bugs.
- Yield durations are monotonically weighted: short-end (DGS2) reacts more strongly to rate-policy surprises than long-end (DGS30). Not a hard invariant but worth a soft check (e.g., `|DGS2.positive| >= |DGS30.positive|` for FEDFUNDS).

---

## Integration notes for Phase 1c kickoff manifest

When CC produces the Phase 1c manifest, include:

1. **Files to create:**
   - `src/lib/entities/sources/forex.ts` (~120 lines, 20 pairs)
   - `src/lib/entities/sources/yields.ts` (~60 lines, 8 yields)
   - Both wired into `src/lib/entities/registry.ts` orchestrator alongside SEC/CoinGecko/futures/ETFs.

2. **Files to modify:**
   - `src/lib/entities/types.ts` — add `'yield'` to `EntityCategory` union
   - `src/lib/historical-data/direction-maps.ts` — extend every existing indicator's map with forex + yield entries (no new indicators, just broader asset coverage)
   - `src/__tests__/historical-direction-maps.test.ts` — add coverage tests per section above
   - `scripts/seed-entities.ts` — include new sources in the orchestrator run (orchestrator changes handle this automatically if registry.ts is updated)

3. **Entity count verification:**
   - Pre-amendment (Phase 1b): ~11,089
   - Post-amendment target: ~11,117 (+20 forex +8 yields, assuming no dedupes)
   - Update `entity-registry.test.ts` expected counts accordingly.

4. **Historical data load (already scaffolded):**
   - Yields: pull from FRED via existing `fred-client.ts` — add 8 new entries to `FRED_INDICATORS` array alongside the existing 15 macro indicators. 5yr of daily yields = ~1,250 MacroRelease rows per yield × 8 = ~10K rows.
   - Forex: no historical release data (forex is continuously priced, not released). No MacroRelease rows for forex pairs. Direction maps apply on macro surprise days, which already have rows.

---

## Why this lives in Phase 1c, not Phase 1b

- Direction-mapping additions reference forex/yield identifiers that Phase 1b doesn't have. Adding them in 1b would create dangling references.
- Forex and yields are natural paired additions to the trigger system (triggered by macro surprises) — Phase 1c is where those triggers land.
- Small, self-contained: ~200 lines of code + ~100 lines of mapping additions. Doesn't expand Phase 1c scope materially.

---

## Approval expected at Phase 1c kickoff

Claude Code will produce a Phase 1c manifest when Conner kicks off. That manifest should fold this amendment in under a dedicated section (e.g., "Entity registry expansion: forex + yields") rather than treating it as a separate phase. Single branch, single commit series, single merge.
