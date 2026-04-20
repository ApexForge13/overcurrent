# Phase 8 — Polygon.io Scaffolding + PACER Double-Gate (Design)

**Date:** 2026-04-19
**Status:** Approved. Implementation to follow via writing-plans.
**Predecessors:** Phases 1–7 deployed. Cost-optimization layer (5 flags + 380 tests) committed.
**Successor in queue:** Phase 9 — social layer integrations (Twitter/X, Telegram, Reddit). Stop and show results before starting Phase 9.

---

## Scope

Phase 8 ships **scaffolding only**. No public-facing UI. Two deliverables:

1. **Polygon.io integration** — Stocks Starter tier ($29/mo): EOD OHLCV + 15-min delayed snapshots + tickers/financials reference. Full graceful degradation; integration deploys before the API key does.
2. **PACER double-gate approval workflow** — admin UI at `/admin/pacer`. Cluster-level Gate 1 (binary investigate / dismiss) + per-document Gate 2 (only triggered when estimated cost exceeds a configurable threshold).

Both feed the universal `RawSignalLayer` table; consumer surfaces are owned by Phase 11 (entity dossier financial-correlation tab) and Phase 13/17/18 (paywall + visibility model).

---

## 1. Architecture

```
Cluster finalized → runner.ts dispatches raw-signal queue
  ├─ polygon (always-on, every cluster)
  │    └─ resolve cluster.entities → TickerEntityMap → tickers[]
  │         ├─ tickers.length === 0  → write 1 RawSignalLayer row,
  │         │                          confidenceLevel='unavailable',
  │         │                          haikuSummary='No equity-tradable entities resolved'
  │         └─ for each ticker:
  │              ├─ EOD bar          (/v2/aggs/ticker/{T}/prev)
  │              ├─ snapshot         (/v2/snapshot/locale/us/markets/stocks/tickers/{T})
  │              ├─ ticker reference (/v3/reference/tickers/{T})
  │              └─ Haiku assessment → 1 RawSignalLayer row per ticker
  │         └─ Failure modes (per row):
  │              - POLYGON_API_KEY absent → confidenceLevel='unavailable'
  │              - Ticker not in Polygon universe → confidenceLevel='unavailable'
  │              - Endpoint timeout/HTTP error → confidenceLevel='unavailable',
  │                                              partial endpoints still recorded
  │
  └─ courtlistener (existing, unchanged)
       └─ if metadata returns ≥2 cases → enqueue PACER RawSignalQueue row,
                                         status='requires_approval'
            └─ admin reviews at /admin/pacer
                 ├─ Gate 1: cluster-level binary "investigate / dismiss"
                 └─ Gate 2: per-document confirm
                      (only when estCost > PACER_AUTO_PULL_THRESHOLD_USD)
                      └─ pull doc → write RawSignalLayer
                                  → if recapContribution=true, push to RECAP archive
```

### Hard invariants (assertion functions, throw on violation)

Mirrors the pattern of `assertTier1FullDebate` and `assertContestedClaimDebated` from the cost-optimization layer.

- **`assertEveryClusterHasPolygonRow(clusterId)`** — every finalized cluster has at least one `RawSignalLayer` row with `signalSource='polygon'`. Enforced at the end of the raw-signal queue dispatch step.
- **`assertNoPacerPullWithoutGateApproval(rawSignalLayerId)`** — no PACER-derived `RawSignalLayer` row exists unless the linked `RawSignalQueue.approvedByAdmin=true` AND either `estimatedCost ≤ threshold` OR a corresponding `PacerDocumentApproval.approvedAt IS NOT NULL` exists. Enforced as a pre-write check inside the PACER pull worker.

---

## 2. Schema changes

Minimal — most scaffolding already exists in the schema.

### Edit `prisma/schema.prisma`

**`HistoricalEquityBaseline`** — fix the comment to reflect Polygon as the canonical source. Phase 10 will populate this table from Polygon EOD; Phase 8 does not write to it.

```diff
- // HistoricalEquityBaseline — Yahoo Finance six-month OHLCV backfill.
+ // HistoricalEquityBaseline — Polygon EOD OHLCV backfill (Phase 10 populates).
  // NEVER feeds trajectory scores, momentum flags, or predictive confidence percentages.
  model HistoricalEquityBaseline { ... }
```

No column changes. No `RawSignalLayer` changes. No `RawSignalQueue` changes (existing `estimatedCost`, `actualCost`, `recapContribution`, `approvedByAdmin`, `approvalRequestedAt`, `approvedAt`, `approvedOrDeniedBy`, `status='requires_approval'` cover Gate 1 fully).

### New table `PacerDocumentApproval`

Per-document Gate 2 audit log. `RawSignalQueue` is per-cluster-per-source; PACER pulls multiple documents per cluster, so the relationship is one-to-many.

```prisma
model PacerDocumentApproval {
  id                  String   @id @default(cuid())
  rawSignalQueueId    String
  rawSignalQueue      RawSignalQueue @relation(fields: [rawSignalQueueId], references: [id], onDelete: Cascade)
  docketEntryId       String                       // PACER's docket entry id
  docketNumber        String
  court               String
  description         String                       // e.g. "Memorandum in Support, 47 pages"
  pageCount           Int
  estimatedCostUsd    Float
  actualCostUsd       Float?                       // populated after pull
  recapContribute     Boolean  @default(true)
  approvedAt          DateTime?
  approvedBy          String?                      // admin email
  declinedAt          DateTime?
  declinedReason      String?
  recapContributedAt  DateTime?
  resultSignalLayerId String?                      // FK to RawSignalLayer once pulled
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([rawSignalQueueId])
  @@index([approvedAt])
  @@index([declinedAt])
}
```

Add reciprocal relation field `pacerDocumentApprovals PacerDocumentApproval[]` on `RawSignalQueue`.

---

## 3. Polygon integration

### File: `src/lib/raw-signals/integrations/polygon.ts`

Mirrors the shape of `src/lib/raw-signals/integrations/courtlistener.ts`. Module exports `polygonRunner: IntegrationRunner`.

**Environment:** `POLYGON_API_KEY` (optional — absence is the dominant degradation path on day one).

**Endpoints:**

| Endpoint | Path | Returns |
|---|---|---|
| EOD bar | `/v2/aggs/ticker/{T}/prev` | open, high, low, close, volume of previous trading day |
| Delayed snapshot | `/v2/snapshot/locale/us/markets/stocks/tickers/{T}` | last quote (15-min delayed), day's session data |
| Ticker reference | `/v3/reference/tickers/{T}` | name, sector (SIC), market cap, primary exchange |

**Per-ticker call:** all three endpoints fire in parallel with an 8s timeout each. Each endpoint has an independent fallback. A single endpoint failure degrades that field; the row is still written with the partial data.

**Trigger logic (always-on):**

```typescript
const tickers = await resolveTickersForCluster(cluster.entities)
if (tickers.length === 0) {
  return [{
    rawContent: { resolvedTickers: [], cluster_entities: cluster.entities.slice(0, 10) },
    haikuSummary: 'No equity-tradable entities resolved',
    signalSource: 'polygon',
    confidenceLevel: 'unavailable',
    divergenceFlag: false,
    // ...
  }]
}
return await Promise.all(tickers.map(pullPerTicker))
```

**Haiku assessment per ticker:** "Did equity price move >2σ within 72h of cluster.firstDetectedAt? If yes, divergenceFlag=true with `raw_corroborates_narrative` description." Below 1 ticker resolved, no divergence flag (matches courtlistener's "below threshold" rule).

**Cost log:** Polygon is flat-fee unlimited. Per-call cost is $0 in `CostLog`; one monthly accrual line item logged separately by an admin task (out of Phase 8 scope, noted for ops).

**Tests:** `src/__tests__/raw-signals/polygon.test.ts` covers six paths:

1. `POLYGON_API_KEY` absent → unavailable row written, no HTTP calls made
2. Cluster has no ticker-resolvable entities → single unavailable row written
3. All three endpoints succeed for a single ticker → row written with full data, divergenceFlag set per Haiku
4. EOD succeeds, snapshot + reference fail → row written with partial data, confidenceLevel='medium'
5. All three endpoints time out for a ticker → unavailable row, error message captured
6. Ticker resolves but Polygon returns 404 (not in universe) → unavailable row with specific reason

---

## 4. PACER admin UI

### Route: `/admin/pacer/page.tsx`

Server component. Reads `RawSignalQueue` rows where `signalType='pacer' AND status IN ('requires_approval','running')`, joined with `PacerDocumentApproval`.

### Layout (three sections)

**Section 1 — Clusters awaiting Gate 1**

Card per cluster:
- Cluster headline, firstDetectedAt, entity list
- CourtListener metadata preview: case names, courts, dates, dockets
- Estimated total cost across suggested documents (sum of fees PACER reports for each docket)
- Two buttons:
  - **Investigate** — calls `approveCluster` server action: sets `RawSignalQueue.approvedByAdmin=true`, `status='running'`, `approvedAt=now()`, `approvedOrDeniedBy=session.email`, then fans out per-document `PacerDocumentApproval` rows
  - **Dismiss** — calls `dismissCluster`: sets `status='skipped'`, `dismissalReason` (admin-typed)

**Section 2 — Documents awaiting Gate 2**

List of `PacerDocumentApproval` rows where `approvedAt IS NULL AND declinedAt IS NULL AND estimatedCostUsd > threshold`.

Per row:
- Docket number, court, description, page count
- Estimated cost in USD
- RECAP-contribute toggle (default ON, matches schema default)
- **Approve** / **Decline** buttons

Below-threshold rows (`estimatedCostUsd ≤ threshold`) bypass this section entirely — they auto-approve when cluster Gate 1 fires.

**Section 3 — Recently completed**

Last 20 PACER pulls. Per row: docket, actual cost, divergence flag, link to resulting `RawSignalLayer`.

### Server actions (`src/app/admin/pacer/actions.ts`)

- `approveCluster(rawSignalQueueId)` — Gate 1 approve, fans out per-doc rows, auto-pulls below-threshold docs
- `dismissCluster(rawSignalQueueId, reason)` — Gate 1 deny
- `approveDocument(pacerDocumentApprovalId, recapContribute)` — Gate 2 approve, triggers actual PACER pull
- `declineDocument(pacerDocumentApprovalId, reason)` — Gate 2 deny

All actions write `approvedBy = session.user.email` (admin email gate enforced by existing middleware in `src/middleware.ts`).

### Cost threshold

`PACER_AUTO_PULL_THRESHOLD_USD` env var, default `1.00`. Read at request time via `process.env.PACER_AUTO_PULL_THRESHOLD_USD ?? '1.00'`. Below this, Gate 2 is skipped (auto-approval on Gate 1).

---

## 5. Test surface

| File | Tests |
|---|---|
| `src/__tests__/raw-signals/polygon.test.ts` | 6 unit tests (degradation matrix above) |
| `src/__tests__/raw-signals/invariants/polygon-row.test.ts` | `assertEveryClusterHasPolygonRow` throws when row missing; passes when ≥1 row exists |
| `src/__tests__/admin/pacer/actions.test.ts` | 3 tests: Gate 1 approve fans out correct per-doc rows; Gate 2 below-threshold auto-pulls; Gate 2 above-threshold blocks until per-doc confirm logged |
| `src/__tests__/raw-signals/invariants/pacer-gate.test.ts` | `assertNoPacerPullWithoutGateApproval` throws when gate skipped; passes after both gates approve |

Total: 11 new tests. Add to `vitest.config.ts` discovery if not auto-picked up.

---

## 6. Out of scope (deferred to later phases)

- **Public financial-correlation tab on entity dossier** — Phase 11
- **Subscriber-tier story-page financial strip** — Phase 13/17/18
- **Free-tier preview/teaser** — Phase 13/17/18
- **`isFreeRun` Polygon exclusion** — pipeline-flags layer, Phase 13/17/18
- **Backfilling `HistoricalEquityBaseline`** — Phase 10 historical backfill
- **`visibility` field + public approval gate** — Phase 13/17/18
- **Polygon monthly cost accrual logging** — ops task, not Phase 8

---

## Editorial / language compliance

Per `CLAUDE.md` non-negotiable language rules, all `haikuSummary` strings must:

- Use **"unavailable"** or **"not found in available financial data"** rather than implying absence ≠ checked
- Never use **"verified"** — use **"high confidence"** if confidenceLevel='high'
- Never claim universal market-coverage absence — always scope to "not found in Polygon universe" or "ticker not mapped in our entity registry"

This mirrors the Hormuz cluster `adminNotes` hardening rules carried in standing editorial notes.

---

## Acceptance criteria for "Phase 8 done"

1. `prisma migrate` applied cleanly with the `PacerDocumentApproval` table and the comment-only edit on `HistoricalEquityBaseline`
2. `polygon.ts` integration deployed to Railway, runs against every finalized cluster, writes ≥1 `RawSignalLayer` row per cluster regardless of API key state
3. `/admin/pacer` page renders all three sections, all four server actions work
4. All 11 new tests pass, full test suite still green (≥380 prior tests + 11 new)
5. Both invariant assertions wired into the production code paths and demonstrably throw on violation
6. Stop. Show results to user before starting Phase 9.
