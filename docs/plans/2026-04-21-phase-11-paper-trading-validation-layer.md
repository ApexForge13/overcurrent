# 2026-04-21 — Phase 11: Paper Trading Validation Layer

> **Status:** Planning document only — not yet implemented.
> **Depends on:** Phase 2 (Gap Score computation live) and at minimum the featured-set scanning producing regular outputs.
> **Do not start before:** Gap Score is producing real scores against real signals.
>
> This document captures the design verbatim from the v2 master prompt addition. Any refinement based on real paper-trading behavior belongs in a follow-up plan under `docs/plans/`.

---

# PART 11 — PAPER TRADING VALIDATION LAYER

**Context for Claude Code:** This is an addition to the v2 master prompt. It defines a self-validating feedback loop where every Gap Score flag above a threshold automatically generates a simulated trade, executes it in a paper trading account, tracks the outcome, and logs the result to a public performance dashboard.

**This is Phase 2.5 work.** It depends on Gap Score computation being live (Phase 2 complete) and at minimum the featured-set scanning producing regular outputs. Do NOT start this before Gap Score is producing real scores against real signals.

---

## 11.0 — WHY THIS EXISTS

Four purposes, ranked by importance:

1. **Self-validating evidence.** Every Gap Score flag becomes a recorded prediction with a measurable outcome. After 60-90 days, the dataset is impossible to fake and difficult to argue with.

2. **Trigger engine calibration.** Paper trading outcomes tell us which trigger types actually produce profitable flags and which don't. This feedback loops back into trigger threshold tuning and signal weighting.

3. **Content generation.** Daily and weekly performance summaries become shareable, specific, verifiable content for Reddit/Twitter/LinkedIn. "Yesterday our system flagged X at Gap 78, went long, exited +4.2%" is gold-standard FinTwit content.

4. **Quant-readiness.** When the Year 2 quant hire joins, they get a labeled dataset of hundreds-to-thousands of trades with known inputs (Gap Score + decomposition) and known outputs (P&L). This dramatically accelerates signal-tier product development.

---

## 11.1 — SCOPE AND CONSTRAINTS

**In scope for v1 of this layer:**

- Alpaca paper trading integration for equities and crypto
- Simulated-fill paper trading for commodities (via ETF proxies OR direct simulated fills)
- LLM-generated strategy output from Gap Score + decomposition
- Position tracking with automatic exit on time-based or price-based conditions
- Outcome logging with full audit trail
- Public performance dashboard page
- All required disclaimers and safe harbor language

**Out of scope for v1:**

- Real money trading (never, at least not in v1 — different product, different regulatory footprint)
- User-initiated trades from the dashboard
- Portfolio construction or risk management across multiple positions
- Strategy optimization or backtesting beyond forward paper trading
- Options or multi-leg strategies (keep it simple: long or short an asset, with stop/target)

**Hard constraints:**

- Every trade must link back to the Gap Score that triggered it
- Every LLM-generated strategy must be logged verbatim (both input and output)
- No cherry-picking, no deletion of losing trades, no "these don't count" exclusions
- Public dashboard shows the full dataset, no filter manipulation

---

## 11.2 — ARCHITECTURE

```
Gap Score fires (score >= threshold)
  ↓
Strategy Generator Worker
  (Sonnet call with versioned prompt)
  Input: gap score + decomposition + asset metadata + current price
  Output: {direction, entry_price, stop_loss, take_profit, time_horizon_hours, confidence, reasoning}
  ↓
Trade Executor
  → Alpaca API for equities + crypto
  → Simulated-fill logic for futures/commodities (use proxy ETF OR direct simulated fill against free price feed)
  ↓
Position Tracker (cron, every 5 min)
  → Check exit conditions on all open positions
  → Close positions when: stop hit, target hit, time expired
  → Record exit price, P&L, duration
  ↓
Performance Aggregator (cron, hourly)
  → Recompute rolling performance metrics
  → Update HotListSnapshot and public dashboard cache
  ↓
Public Dashboard
  → /performance page
  → Live open positions, closed trade history, rolling metrics
```

---

## 11.3 — TRIGGER THRESHOLD FOR PAPER TRADES

Not every Gap Score flag generates a paper trade. That would be noisy and expensive. Initial threshold:

- Paper trade fires when **Gap Score >= 65 AND the dominant pairwise divergence has confidence >= 0.6**
- Additional guardrail: **no more than 1 open paper trade per asset at any time** (skip if one is already open)
- Additional guardrail: **no more than 20 concurrent open paper trades across the system** (LIFO skip, log the skip)

These thresholds are v1 and will be tuned based on early results. Make them configurable via `PAPER_TRADING_MIN_GAP_SCORE`, `PAPER_TRADING_MIN_CONFIDENCE`, and `PAPER_TRADING_MAX_CONCURRENT` env vars.

---

## 11.4 — ALPACA INTEGRATION

**File:** `src/lib/paper-trading/alpaca-client.ts`

```typescript
// Wrap @alpacahq/alpaca-trade-api
// Use paper trading endpoints only: https://paper-api.alpaca.markets
// Required env vars: ALPACA_PAPER_KEY, ALPACA_PAPER_SECRET
```

**Coverage:**
- US equities: direct trading via ticker
- Crypto: direct trading via ticker (BTC/USD, ETH/USD, etc.)
- Commodities: NOT SUPPORTED by Alpaca — use ETF proxies (see 11.5)

**Order type for v1:** Market orders only. Paper trading makes limit orders simulation-brittle; market orders with realistic slippage assumptions are cleaner.

**Position sizing:**
- Fixed notional size per trade: $10,000 (configurable via `PAPER_TRADING_NOTIONAL_USD`)
- Share count computed from current price at fill time
- All positions are unlevered (1x)

**Rate limiting:**
- Alpaca paper trading API has generous limits but still log every call to CostLog (service: "alpaca_paper", cost: 0)
- Handle rate limit errors gracefully — queue retries

---

## 11.5 — COMMODITY PROXY STRATEGY

Alpaca doesn't cover futures. Two options per commodity, configurable:

**Option A: ETF proxy mapping**

```typescript
// src/lib/paper-trading/commodity-proxy-map.ts
export const COMMODITY_PROXIES = {
  "WTI": { etf: "USO", multiplier: 1.0 },
  "BRENT": { etf: "BNO", multiplier: 1.0 },
  "NG": { etf: "UNG", multiplier: 1.0 },
  "GC": { etf: "GLD", multiplier: 1.0 },
  "SI": { etf: "SLV", multiplier: 1.0 },
  "HG": { etf: "CPER", multiplier: 1.0 },
  "ZW": { etf: "WEAT", multiplier: 1.0 },
  "ZC": { etf: "CORN", multiplier: 1.0 },
  "ZS": { etf: "SOYB", multiplier: 1.0 },
};
```

Paper trades on commodities execute against the ETF proxy. Disclaimer on dashboard: "Commodity trades executed against ETF proxies, which track but do not perfectly replicate underlying commodity prices."

**Option B: Direct simulated fill**

For commodities without a liquid ETF proxy, log a simulated fill against the free price feed (Yahoo/Alpha Vantage):

```typescript
// src/lib/paper-trading/simulated-fill.ts
// Record: entry_price (from price feed at trigger moment)
// On exit condition: exit_price (from price feed at exit moment)
// P&L computed from price delta × notional / entry_price
```

Disclaimer: "Simulated execution — no real market impact modeled."

**v1 recommendation:** Use Option A (ETF proxies) where available, Option B as fallback. Label clearly in the trade record which method was used.

---

## 11.6 — STRATEGY GENERATION PROMPT

**File:** `src/lib/paper-trading/prompts/strategy-v1.ts`

Load as a versioned prompt via the `PromptVersion` table from v2 Part 3.1.

**Prompt structure (outline):**

```
You are generating a paper-trading strategy for an information product called Overcurrent.
This is NOT investment advice. This is a systematic strategy generator for validation purposes only.

Given:
- Asset: {ticker, name, category, current_price}
- Gap Score: {score 0-100}
- Decomposition: {narrative scalar/confidence, psychological scalar/confidence, ground_truth scalar/confidence}
- Contributing signals: {list of top 5-10 signals driving the divergence}
- Recent price history: {last 5 days OHLC}

Output a structured trade recommendation with these HARD CONSTRAINTS:
- direction: "long" or "short"
- stop_loss_pct: between 2.0 and 5.0 (% from entry)
- take_profit_pct: between 3.0 and 10.0 (% from entry)
- time_horizon_hours: between 24 and 168 (1-7 days)
- confidence: 0.0 to 1.0

Rules:
1. Direction is determined by the dominant divergence. If ground truth is bullish but narrative is bearish, and ground truth confidence > narrative confidence, direction is "long" (betting the ground truth is correct).
2. If all three streams point the same direction, this is NOT a divergence — return {"direction": "skip", "reasoning": "no divergence"} (the trigger shouldn't have fired, but safety check).
3. take_profit_pct must be > stop_loss_pct (positive expected value structure)
4. time_horizon reflects how long the divergence typically takes to resolve (24h for news-driven, 48-168h for positioning-driven)
5. confidence should reflect stream agreement — higher when streams clearly disagree, lower when confidence is borderline

Output schema (strict JSON):
{
  "direction": "long" | "short" | "skip",
  "stop_loss_pct": number,
  "take_profit_pct": number,
  "time_horizon_hours": integer,
  "confidence": number,
  "reasoning": string (max 300 chars, explaining which divergence drove the decision)
}
```

**Variance test:** Same structure as sentiment scoring. 50 historical Gap Score events, 3 runs each, target variance on direction decision <= 10% disagreement rate.

**Prompt iteration budget:** 5-10 iterations over the first 2 weeks of paper trading. Log every iteration as a new version in PromptVersion.

---

## 11.7 — DATABASE SCHEMA

Add via Prisma migration:

```prisma
model PaperTrade {
  id              String   @id @default(cuid())
  gapScoreId      String
  gapScore        GapScore @relation(fields: [gapScoreId], references: [id])
  entityId        String
  entity          TrackedEntity @relation(fields: [entityId], references: [id])
  
  // Strategy output
  strategyOutputId String?
  strategyOutput   StrategyOutput? @relation(fields: [strategyOutputId], references: [id])
  
  // Execution
  direction       String   // "long" | "short"
  notionalUsd     Float
  shareCount      Float
  
  // Entry
  entryTimestamp  DateTime
  entryPrice      Float
  entryMethod     String   // "alpaca" | "etf_proxy" | "simulated_fill"
  proxyTicker     String?  // if ETF proxy used
  alpacaOrderId   String?  // if alpaca-executed
  
  // Exit conditions
  stopLossPct     Float
  takeProfitPct   Float
  stopLossPrice   Float
  takeProfitPrice Float
  timeHorizonHours Int
  expiresAt       DateTime
  
  // Exit (null until closed)
  exitTimestamp   DateTime?
  exitPrice       Float?
  exitReason      String?  // "stop_loss" | "take_profit" | "time_expired" | "manual_close"
  
  // P&L
  plDollars       Float?
  plPercent       Float?
  
  // Status
  status          String   @default("open")  // "open" | "closed" | "failed"
  
  strategyPromptVersion String
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([status])
  @@index([entityId, status])
  @@index([entryTimestamp])
  @@index([exitTimestamp])
  @@index([gapScoreId])
}

model StrategyOutput {
  id            String   @id @default(cuid())
  gapScoreId    String
  
  inputPayload  Json     // full input given to the LLM
  rawOutput     String   @db.Text // raw LLM response
  parsedOutput  Json     // parsed decision object
  
  promptVersion String
  modelVersion  String
  inputTokens   Int?
  outputTokens  Int?
  
  paperTrades   PaperTrade[]
  
  createdAt     DateTime @default(now())
  
  @@index([gapScoreId])
  @@index([createdAt])
}

model PerformanceSnapshot {
  id                  String   @id @default(cuid())
  capturedAt          DateTime @default(now())
  periodDays          Int      // 7, 30, 90, all-time
  
  totalTrades         Int
  openTrades          Int
  closedTrades        Int
  wins                Int
  losses              Int
  winRate             Float
  avgWinPct           Float
  avgLossPct          Float
  avgTradeReturnPct   Float
  totalReturnPct      Float
  totalReturnDollars  Float
  
  byStreamDominant    Json     // performance broken down by which stream drove the divergence
  byAssetCategory     Json     // equity / commodity / crypto split
  byGapScoreBucket    Json     // 65-70, 70-80, 80-90, 90+ performance
  
  @@index([capturedAt, periodDays])
}
```

---

## 11.8 — WORKERS AND QUEUES

Add new BullMQ queues:

```typescript
// Queue: paper-trading:strategy-generate
// Consumer: reads from Gap Scores above threshold, generates strategy via Sonnet
// Triggered by: post-save hook on GapScore when score >= threshold
// Concurrency: 5

// Queue: paper-trading:execute
// Consumer: takes StrategyOutput, executes trade via Alpaca or simulated fill
// Concurrency: 3 (respect Alpaca rate limits)

// Queue: paper-trading:monitor-positions
// Cron: every 5 minutes
// Checks all open PaperTrades for exit conditions
// Closes positions when triggered

// Queue: paper-trading:aggregate-performance
// Cron: every hour
// Recomputes PerformanceSnapshot for 7d, 30d, 90d, all-time
```

All queue events log to CostLog where LLM calls are involved.

---

## 11.9 — PUBLIC PERFORMANCE DASHBOARD

**Route:** `/performance`

**Access:** Public (no auth required). This is a credibility asset, not a paid feature.

**Content:**

**Hero section:**
- Large: "X% total return over last 90 days on Y paper trades"
- Subtext: "Live performance of Overcurrent's signal-triggered paper trading system"
- Disclaimer callout: "Paper trading only. Not investment advice. Past performance does not guarantee future results. [link to methodology]"

**Rolling metrics cards:**
- Last 7 days: return %, trade count, win rate
- Last 30 days: same
- Last 90 days: same
- All-time: same

**Performance chart:**
- Cumulative P&L curve over time
- Markers for significant trades

**Open positions table:**
- Asset, direction, entry price, current price, unrealized P&L, time until expiry

**Closed trade history:**
- Paginated, filterable, sortable
- Shows: asset, direction, entry/exit, duration, P&L, Gap Score at entry
- Click-through to original Gap Score decomposition page

**Breakdowns:**
- Performance by asset category (equity/commodity/crypto)
- Performance by dominant divergence type (narrative-led / psychological-led / ground-truth-led)
- Performance by Gap Score bucket (65-70 / 70-80 / 80-90 / 90+)

**Methodology section:**
- Link to `/methodology` page explaining the paper trading system
- Transparent about:
  - Position sizing ($10K notional per trade, fixed)
  - Execution method (Alpaca paper API for equities/crypto, ETF proxies for commodities)
  - No slippage, no fees, no market impact modeled
  - LLM-generated strategy, versioned prompts
  - All trades logged, no curation or cherry-picking

---

## 11.10 — DISCLAIMERS AND LEGAL LANGUAGE

**On every page displaying paper trading data:**

> "The Overcurrent Performance Dashboard shows hypothetical paper trades executed against simulated or paper broker accounts. These results do not represent actual trading and have not generated real financial gains or losses. Overcurrent is not a registered investment advisor. Nothing on this site constitutes investment advice. Past paper trading performance does not predict future results. Trading real securities involves substantial risk of loss."

**On the methodology page:**

Explicit description of all limitations:
- No slippage, fees, or market impact modeled
- ETF proxies imperfectly track underlying commodities
- LLM-generated strategies are experimental and may produce irrational outputs
- Sample size caveats (show the current trade count prominently)

**In the code:**

A constant `src/lib/paper-trading/disclaimers.ts` exporting the canonical disclaimer text. Use it everywhere performance data is rendered. Updating it updates all surfaces.

---

## 11.11 — CONTENT GENERATION

Add admin utilities at `/admin/paper-trading/content`:

**Daily content draft:**
- For each closed trade in the last 24h with >2% return magnitude (win or loss), auto-generate a draft social post
- Format: "Flagged [ticker] at Gap [score]. System went [direction] based on [dominant divergence]. Closed [duration] later at [+/-X%]."
- Include decomposition link and Gap Score details
- One-click copy to clipboard, ready to paste into Twitter/Reddit

**Weekly summary draft:**
- Rolling 7-day performance recap
- Best trade, worst trade, win rate
- Pattern observations (e.g., "Ground-truth-led flags outperformed this week")
- Format suitable for a Substack/LinkedIn post

This is the viral content engine. Make it frictionless.

---

## 11.12 — TESTING REQUIREMENTS

Add to test suite:

1. **Strategy generator tests** — input scenarios produce expected output structure
2. **Variance test** — 50 historical Gap Score events, 3 runs each, direction disagreement <= 10%
3. **Trade executor tests** — Alpaca mock, simulated fill logic, error handling
4. **Position monitor tests** — stop loss / take profit / time expiry triggers
5. **P&L computation tests** — long and short, with proxy and without
6. **Aggregation tests** — performance snapshot correctness for various trade distributions
7. **Concurrent position limits** — system respects PAPER_TRADING_MAX_CONCURRENT
8. **Disclaimer rendering tests** — every public performance surface has the canonical disclaimer

---

## 11.13 — ROLLOUT SEQUENCE

When Phase 2 is complete and Gap Scores are flowing:

**Day 1-2:** Alpaca account setup, env vars, client wrapper. Test basic trade execution manually.

**Day 3-4:** Strategy generator prompt + variance test suite. Iterate until converged.

**Day 5-6:** Trade executor + position tracker. End-to-end test with a handful of manual Gap Score triggers.

**Day 7-10:** Performance aggregator + public dashboard. Run silently for a week before public exposure.

**Day 11-14:** Content generation admin utilities. Start generating daily drafts internally, don't post publicly yet.

**Day 15-30:** Silent operation. Accumulate 30-60 trades. Monitor for prompt issues, bad strategy outputs, edge cases.

**Day 30+:** Public dashboard goes live. Start posting daily content to social. Performance data enters the marketing engine.

---

## 11.14 — OPEN QUESTIONS / FLAGS

1. **Alpaca commodity coverage is zero.** If we later want real paper trading on commodity futures (not proxies), options are limited. tastytrade paper API covers futures but has a fee. For v1, proxies + simulated fills are sufficient. Document the limitation transparently.

2. **LLM cost at scale.** Each Gap Score trigger above threshold = one Sonnet call for strategy generation. Estimate: 50-200 triggers/day × $0.02-0.04 per call = $30-200/month additional. Fits within the existing cost budget but monitor.

3. **Public dashboard caching.** Performance aggregation is expensive at high trade counts. Cache aggressively; compute hourly, not per-request.

4. **Regulatory review.** Before the public dashboard goes live, have the disclaimer language reviewed by a lawyer familiar with SEC marketing rules (~$500 for a 1-hour review with a startup-friendly securities attorney). Do not skip this step. This is a cost line item — budget for it before Day 30.

5. **Trade sizing assumption.** $10K notional per trade is a v1 default. At 20 concurrent trades, the "portfolio" is $200K notional. This is hypothetical — no real capital — but the numbers on the dashboard should feel realistic. If the win rate and returns are compelling, people will ask about real implementation; have a honest "we don't offer real trading, this validates the signal quality" answer ready.

6. **What happens when a trade should have fired but the system was down.** Log missed triggers. Don't back-date trades. The system's honesty about its own gaps is part of its credibility.

7. **Who can close open trades manually?** Admin-only. No user-facing close button. All closes are condition-driven or admin-triggered with an audit log entry.

---

## 11.15 — FINAL NOTES

- **This is a validation layer, not a product.** Users pay for Gap Score and decomposition. Paper trading is proof the score means something.

- **Transparency is the entire value.** Every losing trade published honestly is more credible than a cherry-picked winning record.

- **This dataset is the foundation for the Year 2 quant hire's work.** Treat it as a research asset, not just a marketing asset.

- **Labels matter.** "Paper trading validation" is what this is. "AI trading system" is what it isn't. Don't let content drift toward the second framing — it invites regulatory scrutiny and sets user expectations the product can't meet.

- **Start boring, let the data speak.** Don't hype this publicly until the 30-day silent run is done. Boring, consistent, transparent data wins the long game.
