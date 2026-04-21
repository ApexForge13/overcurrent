# 2026-04-21 — Phase 1 Trigger Spec Addendum

> **Status:** Planning document only — not yet implemented.
> **Depends on:** Phase 0 (legacy-gating commit) landed on main. Phase 1 infrastructure prereqs (BullMQ + Upstash Redis provisioning) completed.
> **Supersedes:** Part 2.2 of the v2 master prompt (trigger system definitions).
> **Companion artifact:** [`2026-04-21-tier-1-zones.md`](2026-04-21-tier-1-zones.md) — the zone registry seed this addendum references as `tier-1-zones.ts`.
>
> This document captures the Phase 1 trigger addendum verbatim. When Phase 1 execution begins, the companion zone-registry artifact should be extracted from its markdown wrapper to `src/lib/gap-score/zones/tier-1-zones.ts` (with the `country` field type widened to `string | null` — see note in that file).

---

# PHASE 1 TRIGGER SPEC — ADDENDUM TO v2 MASTER PROMPT

**Context for Claude Code:** This document supersedes and extends Part 2.2 of the v2 master prompt (trigger system definitions). It reflects clarifications on how triggers work with real-world data constraints — particularly around baseline maturity, satellite limitations, and macro consensus data.

This is Phase 1 work, executed AFTER the Phase 0 legacy-gating commit has landed.

---

## A1.0 — CORE PRINCIPLE

Every trigger is defined by four things:

1. **What we measure** (the raw metric)
2. **What "normal" means** (the baseline — often statistical, sometimes absolute)
3. **When it fires** (the deviation threshold)
4. **How we classify it** (severity + direction mapping)

Baselines for entity-specific metrics accumulate from Day 1. Triggers fire only when the baseline is mature (sample count exceeds a defined floor). Until then, the entity/zone/indicator is in "calibrating" state — visible in admin but not feeding the candidate queue.

This discipline prevents shipping a noisy hot list during the first 30-60 days.

---

## A1.1 — TRIGGER MATURITY GATING

All triggers in this spec track against a `BaselineMaturity` flag. Queue consumers check maturity before firing:

```typescript
interface TriggerBaseline {
  entityId?: string;       // null for system-wide triggers (e.g., macro indicators)
  zoneId?: string;         // for maritime triggers
  metricName: string;
  windowDays: number;
  mean: number;
  stddev: number;
  sampleCount: number;
  isMature: boolean;       // true when sampleCount >= minSampleSize
  minSampleSize: number;   // varies per trigger type
  computedAt: Date;
}
```

**Minimum sample sizes for maturity:**

| Trigger Category | Window | Observation Cadence | Min Sample | Typical Maturity |
|---|---|---|---|---|
| Narrative — article volume | 7 days | per hour | 120 (71% coverage) | 7-10 days |
| Narrative — cross-outlet | n/a | absolute threshold | N/A | immediate |
| Psychological — cashtag velocity | 14 days | per hour | 240 (71%) | 14-18 days |
| Psychological — engagement acceleration | 4 hours | rolling | 48 observations | 2-3 days |
| Ground truth — SEC filings | n/a | absolute threshold | N/A | immediate |
| Ground truth — CFTC | n/a | threshold on delta | N/A | immediate (1st COT release) |
| Ground truth — price move | 30 days | daily close | 25 days | 25-30 days |
| Ground truth — macro surprise | historical | per release | 20 historical releases | immediate (historical data pre-loaded) |
| Maritime AIS | 30 days | 4 obs/day | 90 (75%) | 25-30 days |
| Inventory (EIA/USDA) | historical | per release | 20 historical releases | immediate (pre-loaded) |

---

## A1.2 — NARRATIVE TRIGGERS (Stream 1)

### T-N1: Article volume spike

```
Measure:    Count of articles mentioning entity in rolling 1h window
Baseline:   Rolling 7-day hourly mean + stddev, entity-specific
Minimum:    ≥ 120 hourly observations (7-10 calendar days typical)
Fire when:  current_1h_count > (mean + 2 × stddev)
            AND current_1h_count >= 5 (absolute floor)
Severity:   (current - mean) / stddev, capped at 1.0 at z=4
Direction:  determined by downstream sentiment scoring, not the trigger itself
Cost:       aggregation query on GDELT + outlet registry tables
```

### T-N2: Cross-outlet amplification

```
Measure:    Distinct outlet count for entity in rolling 30min window
Baseline:   N/A — absolute threshold
Fire when:  distinct_outlets >= 5 in 30min window
            AND NOT during a known scheduled event (earnings, Fed day)
Severity:   0.5 at 5 outlets, scales linearly to 1.0 at 10+ outlets
Direction:  downstream sentiment scoring
Cost:       DISTINCT query on outlets table
```

### T-N3: Wire-quality headline event

```
Measure:    Headline pattern match for high-signal event types
Baseline:   N/A — pattern-based
Fire when:  headline matches any of:
              - earnings surprise patterns (beat|miss|missed|beat_consensus)
              - guidance revision (raises|cuts|guidance)
              - M&A (acquires|merger|buyout|takeover)
              - regulatory (FDA|SEC|DOJ|enforcement|fine|approval)
              - exec change (resigns|CEO|CFO)
              - bankruptcy (Chapter 11|bankruptcy)
              - material contract (awarded|terminates contract)
            AND entity is in the article's title/subject (not just body mention)
Severity:   1.0 (binary meaningful)
Direction:  pattern-specific (approval = +1, fine = -1, etc.)
            For ambiguous patterns (e.g., exec change), defer to LLM sentiment
Cost:       regex pass on incoming article headlines
```

### T-N4: Entity sentiment extremity batch

```
Measure:    Count of articles in past 2h with directional keyword match
Baseline:   N/A — absolute threshold
Fire when:  >= 8 keyword-match articles in 2h window
            AND >= 60% same direction (either all bullish keywords or all bearish)
Severity:   scaled by count (8 = 0.5, 20+ = 1.0) × directional_consistency
Direction:  keyword direction (bullish keywords → +1, bearish → -1)
Cost:       keyword match on article titles + descriptions, no LLM
```

**Keyword lists (editable via admin):**
- Bullish: "surges, skyrockets, jumps, breakthrough, approved, beats, upgrades, outperforms, record high, rally, soars, boosts, raises outlook"
- Bearish: "plunges, crashes, tumbles, drops, rejected, misses, downgrades, underperforms, record low, crashes, sinks, cuts outlook, investigation, lawsuit, probe, recall"

---

## A1.3 — PSYCHOLOGICAL TRIGGERS (Stream 2)

### T-P1: Cashtag velocity spike

```
Measure:    Cashtag mentions per hour across Twitter + Reddit + Telegram
Baseline:   Rolling 14-day hourly mean + stddev, entity-specific
Minimum:    ≥ 240 hourly observations
Fire when:  current_1h_velocity > (mean + 3 × stddev)
            AND current count >= 20 (absolute floor)
Severity:   z-score scaled, cap 1.0 at z=5
Direction:  downstream sentiment scoring
Cost:       aggregation across social tables
```

### T-P2: Engagement velocity acceleration

```
Measure:    Engagement (upvotes + replies + likes) per minute on entity posts
Baseline:   Rolling 4h, compare last 1h to previous 1h
Fire when:  last_hour_rate >= 2 × previous_hour_rate
            AND total_engagement >= 100 events in last hour
Severity:   scaled by acceleration factor (2x = 0.5, 5x+ = 1.0)
Direction:  downstream sentiment scoring of the most-engaged posts
Cost:       time-windowed aggregation on posts + engagement tables
```

### T-P3: Cross-platform amplification

```
Measure:    Detection of T-P1 firing on same entity across multiple platforms
            within a 2h window
Baseline:   N/A — meta-trigger
Fire when:  T-P1 fires on entity on 2+ distinct platforms within 2h
Severity:   0.6 for 2 platforms, 1.0 for 3+
Direction:  downstream sentiment scoring
Cost:       simple JOIN on TriggerEvent table
```

### T-P4: Sentiment extremity consensus

```
Measure:    Directional keyword match rate on social posts about entity, past 2h
Baseline:   N/A — absolute threshold
Fire when:  >= 30 directional posts in 2h
            AND >= 75% same direction
Severity:   scaled by count + consistency
Direction:  keyword direction
Cost:       keyword match on post content, no LLM
```

---

## A1.4 — GROUND TRUTH TRIGGERS (Stream 3)

### T-GT1: SEC Form 4 — large insider transaction

```
Measure:    Insider buy or sell transaction from SEC EDGAR Form 4 feed
Baseline:   N/A — absolute threshold
Fire when:  transaction_value_usd >= 1_000_000
            OR transaction_size_pct_of_holdings >= 0.10
            OR (>= 2 insiders at same issuer filing same-direction trades within 48h)
Severity:   log-scaled by dollar amount:
              $1M   → 0.3
              $10M  → 0.6
              $100M+ → 1.0
Direction:  buy = +1, sell = -1
Cost:       scheduled job parsing SEC EDGAR Form 4 feed
```

### T-GT2: SEC 13D/G — activist stake disclosed

```
Measure:    New 13D or 13G filing
Baseline:   N/A
Fire when:  any new filing lands
Severity:   1.0
Direction:  +1 default (large stake accumulation)
            Note: known short-seller activists (hand-curated list) reverse to -1
Cost:       SEC EDGAR filing subscription
```

### T-GT3: SEC 8-K — material event

```
Measure:    8-K filings with specific Item codes
Baseline:   N/A
Fire when:  filing contains Item 1.01, 1.02, 2.01, 2.03, 4.02, or 5.02
Severity:
  Item 1.01 (material agreement):        0.7
  Item 1.02 (material termination):      0.8
  Item 2.01 (completion of acquisition): 0.8
  Item 2.03 (material obligation):       0.7
  Item 4.02 (non-reliance on financials): 1.0  ← AUDITOR WARNING
  Item 5.02 (exec change):               0.6
Direction:  Item 4.02 = -1 always; others depend on headline content (LLM at scoring layer)
Cost:       SEC EDGAR filing subscription + item code parser
```

### T-GT4: CFTC COT — managed money delta

```
Measure:    Weekly change in managed money net position for commodity futures
Baseline:   N/A — week-over-week delta
Fire when:  |week-over-week change in managed_money_net_pct| > 0.10
Severity:   log-scaled:
              10% delta → 0.4
              25% delta → 0.8
              50%+      → 1.0
Direction:  net long increase → +1, net short increase → -1
Timing:     Released Friday after market close (for Tuesday's data);
            available Friday evening ET. Trigger runs Friday evening cron.
Cost:       weekly CFTC COT release parser
```

### T-GT5: Price move — intraday

```
Measure:    Price change from previous close during trading session
Baseline:   30-day realized volatility, entity-specific
Minimum:    25 days of price history
Fire when:  |intraday_change_pct| exceeds category threshold:
              Equity:    3.0%
              Commodity: 2.0%
              Crypto:    5.0%
Severity:   (|change| / realized_volatility), capped at 1.0
            A 3% move on a 1%-vol stock is severity 1.0
            A 3% move on a 5%-vol stock is severity 0.4
Direction:  positive move → +1, negative → -1
Cost:       price feed monitoring (Yahoo/Alpha Vantage for broad equity coverage)
```

### T-GT6: Price gap — overnight

```
Measure:    Opening price vs previous close
Baseline:   30-day realized volatility
Fire when:  |(open - prev_close) / prev_close| exceeds:
              Equity:    2.0%
              Commodity: 1.0%
              Crypto:    4.0%
Severity:   vol-adjusted same as T-GT5
Direction:  positive gap → +1, negative → -1
Cost:       daily open-price pull
```

### T-GT7: Maritime AIS anomaly — Tier 1 zones only

```
Measure:    Ship count + dwell time + draft at each Tier 1 zone
Baseline:   30-day rolling mean + stddev per metric per zone
Minimum:    sampleCount >= 90 per zone-metric (30 days × 4 obs/day × 75% coverage)
Fire when:  current observation > (mean + 2 × stddev)
            OR current observation < (mean - 2 × stddev)
Severity:   z-score scaled
Direction:  per zone category (see classifyZoneDirection in zones/tier-1-zones.ts):
              crude_export + buildup   → -1 (oversupply)
              crude_export + drawdown  → +1 (tight supply)
              crude_import + buildup   → +1 (demand arriving)
              crude_import + drawdown  → -1 (demand soft)
              chokepoint + anomaly     → 0 (disruption, high severity regardless)
Cost:       Datalastic AIS queries every 6h per zone (40 zones × 4/day = 160/day)
Notes:      Zones in "calibrating" state (sampleCount < 90) do NOT fire triggers.
            Dashboard shows zone as "baseline collecting, X days remaining".
```

### T-GT8: Commodity inventory release (REPLACES satellite inventory)

Satellite-derived inventory triggers are deferred to v2 (requires computer vision
engineering effort estimated $100K+ and 2+ years per v2 Part 11 discussion).
v1 uses official inventory data releases as a cleaner signal source.

```
Measure:    Official commodity inventory releases vs consensus expectation
            - EIA weekly crude stocks     (Wed 10:30 ET)
            - EIA weekly natural gas      (Thu 10:30 ET)
            - EIA weekly refined products (Wed 10:30 ET)
            - USDA crop progress          (Mon, during growing season)
            - USDA WASDE                  (monthly)
            - USDA prospective plantings  (March)
            - LME warehouse stocks        (daily)
Baseline:   Historical distribution of (release - consensus) surprises
            Pre-loaded from 5+ years of historical data
Fire when:  |release - consensus| > 1 × stddev of historical surprises
Severity:   (surprise_magnitude / historical_stddev), capped at 1.0 at 3σ
Direction:  Indicator-specific mapping:
              crude build surprise    → -1 for CL/BZ (bearish oversupply)
              crude draw surprise     → +1 for CL/BZ
              nat gas build surprise  → -1 for NG
              nat gas draw surprise   → +1 for NG
              crop condition improves → -1 for ZW/ZC/ZS (more supply)
              crop condition declines → +1 for ZW/ZC/ZS
              LME copper build        → -1 for HG
              LME copper draw         → +1 for HG
Cost:       scheduled scraper per release schedule + consensus scraper
```

### T-GT9: Macro surprise

```
Measure:    Economic data release vs Bloomberg consensus expectation
Baseline:   Historical distribution of (release - consensus) surprises per indicator
            Pre-loaded from 5+ years of historical data (available from FRED + archived
            consensus scraping)
Minimum:    ≥ 20 historical releases for stable stddev
Fire when:  |actual - consensus| > 1 × stddev of that indicator's historical surprises
Severity:   (surprise / stddev), capped at 1.0 at 3σ
Direction:  Indicator-specific mapping (see A1.5 Consensus Data Hub below)
Cost:       consensus scraper + release scraper per indicator
```

### T-GT10: Congressional trade disclosure

```
Measure:    Newly disclosed trade by US Congress member on tracked ticker
Baseline:   N/A — absolute threshold
Fire when:  disclosure lands on tracked ticker
Elevated severity when:
              transaction_value > $50K
              OR multiple members trade same ticker within 30 days
              OR member serves on committee with jurisdiction over issuer's sector
Severity:   base 0.4, +0.2 per elevation condition, cap 1.0
Direction:  buy → +1, sell → -1
Cost:       House + Senate periodic transaction report scrapers (already scoped
            in v2 Part 4.2)
```

### T-GT11: Earnings transcript availability

```
Measure:    New earnings call transcript published on tracked ticker
Baseline:   N/A — event-driven
Fire when:  transcript for tracked ticker becomes available
Severity:   0.7 (fresh earnings is meaningful for ~48h after release)
Direction:  determined by one-time Haiku sentiment scoring of transcript
            (runs when trigger fires, result cached)
Cost:       earnings transcript feed (Seeking Alpha API, Discounting Cash Flows,
            or similar — choose one in Phase 1, cost ~$50-100/month)
```

### T-GT12: Options flow (DEFERRED until Polygon business tier)

Stays gated behind `ENABLE_POLYGON=false` per v2 Part 4.2.

For v1, monitor /r/options high-engagement posts flagging unusual flow as a
proxy via T-P2 (engagement velocity). Not a true ground-truth signal but
provides some coverage.

---

## A1.5 — CONSENSUS DATA HUB (new component for Phase 1)

Macro triggers (T-GT9) and inventory triggers (T-GT8) both depend on consensus
expectation data. This needs to be scraped before releases and stored alongside
actuals for surprise computation.

### Scraper targets

**Primary:** Investing.com economic calendar
- URL: `https://www.investing.com/economic-calendar/`
- Coverage: all major US + global macro indicators with consensus
- Update cadence: consensus firms up 1-24h before release

**Backup:** Trading Economics economic calendar
- URL: `https://tradingeconomics.com/calendar`
- Use as fallback if Investing.com scraper breaks

**Commodity inventory consensus:**
- EIA consensus: Reuters poll (scraped from Reuters news articles pre-release)
- USDA consensus: Bloomberg, Reuters poll (same pattern)

### Schedule

Run consensus scraper 2 hours before each scheduled release:
- NFP: first Friday of month, 8:30 ET → scraper runs 6:30 ET
- CPI: monthly, ~8:30 ET → scraper runs 6:30 ET
- EIA crude: weekly Wed, 10:30 ET → scraper runs 8:30 ET
- Fed FOMC: scheduled 8x/year, 14:00 ET → scraper runs 12:00 ET
- etc.

### Storage

```prisma
model MacroRelease {
  id              String   @id @default(cuid())
  indicator       String   // "NFP", "CPI_MOM", "EIA_CRUDE", etc.
  releaseDate     DateTime
  consensusValue  Float?
  consensusSource String?  // "investing.com" | "trading_economics" | etc.
  consensusScraped DateTime?
  actualValue     Float?
  actualReleased  DateTime?
  surprise        Float?   // (actual - consensus)
  surpriseZscore  Float?   // (surprise / historical_stddev)
  unit            String   // "K jobs", "%", "bbl", etc.

  @@index([indicator, releaseDate])
  @@index([releaseDate])
}

model MacroIndicatorConfig {
  id              String   @id @default(cuid())
  indicator       String   @unique
  displayName     String
  category        String   // "employment" | "inflation" | "growth" | "inventory" | etc.
  releaseSchedule String   // cron expression or description
  historicalStddev Float   // computed once from 5yr history
  directionMapping Json    // per-asset direction when surprise positive/negative
  relevantAssets  String[] // ticker list

  @@unique([indicator])
}
```

### Direction mapping examples

```typescript
// src/lib/gap-score/triggers/macro-direction.ts
export const MACRO_DIRECTION_MAP = {
  NFP: {
    unitType: 'surprise_positive_bullish_for_equities',
    mappings: {
      SPY:  { positive: 1,  negative: -1 },
      QQQ:  { positive: 1,  negative: -1 },
      TLT:  { positive: -1, negative: 1 },   // bonds inverse
      DXY:  { positive: 1,  negative: -1 },  // USD strengthens on beats
      GC:   { positive: -1, negative: 1 },   // gold inverse to USD strength
    },
  },
  CPI_MOM: {
    unitType: 'surprise_positive_bearish_for_equities',
    mappings: {
      SPY:  { positive: -1, negative: 1 },   // hot CPI → equities down
      TLT:  { positive: -1, negative: 1 },   // hot CPI → yields up → bonds down
      DXY:  { positive: 1,  negative: -1 },
      GC:   { positive: 1,  negative: -1 },  // gold as inflation hedge
    },
  },
  EIA_CRUDE: {
    unitType: 'surprise_build_bearish',
    mappings: {
      CL:   { positive: -1, negative: 1 },   // build surprise → crude down
      BZ:   { positive: -1, negative: 1 },
      XOM:  { positive: -0.5, negative: 0.5 }, // oil majors follow but diluted
      CVX:  { positive: -0.5, negative: 0.5 },
    },
  },
  // ... expand to all tracked indicators
};
```

---

## A1.6 — KNOWLEDGE HUB (new Pro/Pro+ user surface)

Per your request: Pro and Pro+ users get a dedicated page showing all tracked
macro indicators and their current status. This centralizes the data and builds
trust via transparency.

### Route: `/dashboard/knowledge-hub`

**Access gate:** Pro ($99) and Pro+ ($149) tiers. Free/Individual tier users see
a preview with upgrade CTA.

**Sections:**

**1. Macro Indicators Tracker**
Table of all tracked macro indicators:
- Indicator name + category
- Last release: actual, consensus, surprise magnitude (colored)
- Last release timestamp
- Next release: scheduled date/time
- Historical surprise chart (sparkline)
- Asset impact: which tracked assets this affects

**2. Commodity Inventory Dashboard**
- EIA crude stocks: current level, 4-week rolling, 5-year range
- EIA natural gas storage: same
- USDA crop progress: current season tracking
- LME warehouse stocks: current levels
- Link to upcoming release schedule

**3. CFTC Positioning Tracker**
- Top 9 commodities: managed money net positioning over time
- Week-over-week changes highlighted
- Next release countdown

**4. Fed/Central Bank Calendar**
- FOMC meeting schedule
- ECB, BoJ, BoE schedules
- Recent statement sentiment (derived from Haiku scoring of FOMC minutes)

**5. Key Chokepoint Status**
- Strait of Hormuz, Suez, Malacca, Panama: current tanker/ship counts vs baseline
- Only zones with mature baselines shown; others labeled "calibrating"

**6. Data Freshness Indicator**
Top of page, always visible:
- Last narrative signal: X minutes ago
- Last social signal: X minutes ago
- Last ground truth signal: X minutes ago
- Last Gap Score computation: X minutes ago

Colored green (< 30 min), yellow (30 min - 2h), red (> 2h).

This surface serves two functions:
- **Product utility**: users get one-stop access to the data underlying the system
- **Trust building**: transparency about freshness and source quality

---

## A1.7 — META TRIGGERS

### T-META1: Multi-stream confluence

```
Measure:    Trigger events across multiple streams on same entity
Baseline:   N/A
Fire when:  >= 2 triggers fire from >= 2 different streams (N/P/G) on same entity
            within a 2h window
Severity:   1.0
Direction:  derived from directional triggers within the window (majority vote)
Cost:       query on TriggerEvent table grouped by entity within window
```

### T-META2: Featured set baseline scan

```
Measure:    N/A — scheduled rescan of featured set
Fire when:  every 3h (cron)
Severity:   0.3 (low severity — "just checking in")
Cost:       30 Gap Score computations every 3h = 240/day for featured set
```

---

## A1.8 — EXTENSIBILITY PATTERN

New triggers, new indicators, new zones should all be additive — config, not code:

```typescript
// src/lib/gap-score/triggers/registry.ts

export interface TriggerDefinition {
  id: string;
  stream: 'narrative' | 'psychological' | 'ground_truth' | 'meta';
  description: string;
  requiresBaseline: boolean;
  baselineConfig?: {
    windowDays: number;
    minSampleSize: number;
    observationCadence: string;
  };
  thresholdConfig: Record<string, number>;
  directionMapper: string; // function name in direction-mappers.ts
  severityMapper: string;
  enabled: boolean;        // env-configurable
}

export const TRIGGER_REGISTRY: Record<string, TriggerDefinition> = {
  'T-N1': { /* ... */ },
  'T-N2': { /* ... */ },
  // ... etc
};
```

Admin UI at `/admin/triggers` allows:
- Enable/disable individual triggers
- Tune thresholds live
- View firing rates per trigger per day
- See baseline maturity status across all zones/entities

This becomes the calibration interface for Week 2-3 empirical tuning work.

---

## A1.9 — PHASE 1 TASK LIST (updated)

1. **Infrastructure prereq (1 day):** BullMQ + Upstash Redis scaffold
2. **DB schema migration (1 day):** All new models from v2 Part 3.1 + MacroRelease + MacroIndicatorConfig + ZoneBaseline
3. **TrackedEntity registry (1 day):** Populate 15K entities
4. **Zone registry seed (0.5 day):** Load Tier 1 zones from `tier-1-zones.ts`
5. **Baseline computation infra (1 day):** Rolling statistics workers for all baseline types
6. **Consensus data scraper (1 day):** Investing.com + Trading Economics, 15-20 indicators
7. **Historical surprise data load (0.5 day):** Pre-load 5yr of macro + inventory history, compute stddevs
8. **Trigger framework (1 day):** Types, registry, dispatcher, meta-trigger logic
9. **Individual trigger implementations (3 days):** ~20 triggers across the three streams
10. **Candidate generator (1 day):** Combines trigger events into Gap Score queue
11. **Knowledge Hub page (1.5 days):** Pro/Pro+ macro data surface
12. **Admin trigger tuning UI (1 day):** `/admin/triggers` for threshold management

**Total: ~12-13 days** of Phase 1 work at your pace.

---

## A1.10 — FINAL NOTES

- **Baselines are the product's memory.** Protect them. If the Redis/DB goes down and we lose observations, that's days or weeks of recovery. Back up baseline tables daily.

- **"Calibrating" is a feature, not a bug.** Transparency about statistical maturity differentiates you from competitors who pretend their thresholds work on Day 1.

- **Every trigger logs every firing.** TriggerEvent rows aren't gated — even triggers that don't produce candidates get logged. This is research data for future calibration.

- **Direction mapping is the hardest part.** The macro and inventory direction maps will need real trader input to refine. Flag anywhere the mapping feels uncertain; we'll iterate.

- **Satellite is Year 2.** Don't let "we should use satellite data for this" distract from building the real v1. Path B (relative change detection) + Path C (proxy through official sources) is v1. Path A (full computer vision pipeline) is Year 2 with an engineer hire.

- **Knowledge Hub is a trust anchor.** Even users who don't actively use it benefit from knowing it exists. Show it prominently in the Pro/Pro+ feature list. It's the "Bloomberg Terminal feel" on a $99/month product.

When in doubt, ask before coding.
