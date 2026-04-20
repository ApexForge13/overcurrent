# Phase 8 — Polygon Scaffolding + PACER Double-Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Polygon.io Stocks-Starter integration (always-on, fully degrades without API key) and PACER cluster-level + per-document double-gate approval workflow at `/admin/pacer`. Admin-only surfaces; no public UI in this phase.

**Architecture:** Polygon writes one `RawSignalLayer` row per cluster (multi-ticker JSON payload, matches existing `courtlistener` runner pattern; per-entity fan-out via existing `onRawSignalWritten` post-hook). PACER queue entries land at `status='requires_approval'`; admin Gate 1 approves the cluster, fan-out creates `PacerDocumentApproval` rows; Gate 2 confirms each doc above `PACER_AUTO_PULL_THRESHOLD_USD`. Hard invariants throw on violation, mirroring the cost-optimization layer's `assertTier1FullDebate` pattern.

**Tech Stack:** Next.js 14 App Router · TypeScript · Prisma · PostgreSQL · Vitest · Anthropic Haiku for assessment

**Design doc:** [`docs/plans/2026-04-19-phase-8-polygon-pacer-design.md`](./2026-04-19-phase-8-polygon-pacer-design.md)

**Design refinement noted during code review:** Section 3 of the design described "one row per ticker." Implementation collapses to **one row per cluster, multi-ticker payload in `rawContent` JSON** — the existing `IntegrationRunner` contract returns a single `IntegrationResult | null`, and the existing `onRawSignalWritten` post-hook writes per-ticker `EntitySignalIndex` rows downstream. The Q4 invariant ("every cluster gets a Polygon row") still holds.

---

## Task 0: Pre-flight verification

**Step 1: Confirm test harness works**

Run: `cd F:/Overcurrent/overcurrent && npm test -- --run --reporter=verbose 2>&1 | tail -30`
Expected: ≥380 tests pass, exit code 0.

**Step 2: Confirm Prisma schema is in clean state**

Run: `cd F:/Overcurrent/overcurrent && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

**Step 3: Note current branch + status**

Run: `cd F:/Overcurrent/overcurrent && git status --short && git rev-parse HEAD`
Expected: working tree may have pre-existing uncommitted work (`src/lib/quality-review.ts` modified, several untracked scripts) — this is fine, Phase 8 work touches different files. Record the HEAD sha for rollback reference.

---

## Task 1: Schema — fix `HistoricalEquityBaseline` comment

**Files:**
- Modify: `prisma/schema.prisma:1280-1281`

**Step 1: Edit the comment lines**

Use Edit tool. Replace:
```
// HistoricalEquityBaseline — Yahoo Finance six-month OHLCV backfill.
```
with:
```
// HistoricalEquityBaseline — Polygon EOD OHLCV backfill (Phase 10 populates).
```

**Step 2: Verify schema still validates**

Run: `cd F:/Overcurrent/overcurrent && npx prisma validate`
Expected: schema valid.

**Step 3: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
chore: relabel HistoricalEquityBaseline as Polygon EOD source

Phase 10 backfill will populate this from Polygon, not Yahoo.
Comment-only change. No column or relation impact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Schema — add `PacerDocumentApproval` model

**Files:**
- Modify: `prisma/schema.prisma` (append new model after `RawSignalQueue`, add reciprocal relation field on `RawSignalQueue`)

**Step 1: Add reciprocal relation field on `RawSignalQueue`**

Inside `model RawSignalQueue { ... }` block (around line 897-924), after the `resultSignalLayerId String?` line, add:
```prisma
  pacerDocumentApprovals PacerDocumentApproval[]
```

**Step 2: Append the new model after `RawSignalQueue`**

After the closing `}` of `RawSignalQueue` (line 924), insert:
```prisma

// Per-document Gate 2 audit log for PACER pulls.
// Created in fan-out when admin approves Gate 1 on a RawSignalQueue cluster.
// approvedAt is the trigger for the actual PACER pull worker.
model PacerDocumentApproval {
  id                  String   @id @default(cuid())
  rawSignalQueueId    String
  rawSignalQueue      RawSignalQueue @relation(fields: [rawSignalQueueId], references: [id], onDelete: Cascade)
  docketEntryId       String
  docketNumber        String
  court               String
  description         String
  pageCount           Int
  estimatedCostUsd    Float
  actualCostUsd       Float?
  recapContribute     Boolean  @default(true)
  approvedAt          DateTime?
  approvedBy          String?
  declinedAt          DateTime?
  declinedReason      String?
  recapContributedAt  DateTime?
  resultSignalLayerId String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([rawSignalQueueId])
  @@index([approvedAt])
  @@index([declinedAt])
}
```

**Step 3: Validate schema**

Run: `cd F:/Overcurrent/overcurrent && npx prisma validate`
Expected: schema valid.

**Step 4: Generate Prisma client**

Run: `cd F:/Overcurrent/overcurrent && npx prisma generate`
Expected: `Generated Prisma Client` message.

**Step 5: Create migration**

Run: `cd F:/Overcurrent/overcurrent && npx prisma migrate dev --name add_pacer_document_approval --create-only`
Expected: migration file created under `prisma/migrations/`.

**Step 6: Inspect migration SQL**

Run: `ls prisma/migrations/ | tail -1` then Read the SQL file. Confirm it only creates `PacerDocumentApproval` table + index. No drops or column changes elsewhere.

**Step 7: Apply migration**

Run: `cd F:/Overcurrent/overcurrent && npx prisma migrate dev`
Expected: `Already in sync, no schema change or pending migration was found.` OR migration applied.

**Step 8: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(schema): add PacerDocumentApproval model for per-doc Gate 2 audit log

One row per PACER document the admin reviewed in Gate 2. Captures
estimated vs actual cost, approver email, RECAP contribution decision,
and FK to the resulting RawSignalLayer once pulled.

Schema-only change. Phase 8 server actions and pull worker land next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Polygon — stub runner that returns "unavailable" when key absent

**Files:**
- Create: `src/lib/raw-signals/integrations/polygon.ts`
- Create: `src/__tests__/raw-signals/polygon.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/raw-signals/polygon.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { polygonRunner } from '@/lib/raw-signals/integrations/polygon'
import type { RunnerContext } from '@/lib/raw-signals/runner'

const baseCtx: RunnerContext = {
  queueId: 'q1',
  storyClusterId: 'cluster1',
  umbrellaArcId: null,
  signalType: 'financial_equity',
  triggerLayer: 'category_trigger',
  triggerReason: 'always_on_financial',
  approvedByAdmin: false,
  cluster: {
    id: 'cluster1',
    headline: 'Test cluster',
    synopsis: 'Test synopsis',
    firstDetectedAt: new Date('2026-04-15T12:00:00Z'),
    entities: ['Apple Inc'],
    signalCategory: 'corporate_scandal',
  },
}

describe('polygonRunner', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.POLYGON_API_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.POLYGON_API_KEY
    else process.env.POLYGON_API_KEY = originalKey
    vi.restoreAllMocks()
  })

  it('writes unavailable row when POLYGON_API_KEY is absent', async () => {
    delete process.env.POLYGON_API_KEY
    const result = await polygonRunner(baseCtx)
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('polygon')
    expect(result!.confidenceLevel).toBe('unavailable' as never)
    expect(result!.divergenceFlag).toBe(false)
    expect(result!.haikuSummary).toMatch(/Polygon.*not.*provisioned/i)
  })
})
```

**Step 2: Run the test, expect failure**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts`
Expected: FAIL — module `@/lib/raw-signals/integrations/polygon` not found.

**Step 3: Widen the `ConfidenceLevel` type to allow `'unavailable'`**

Modify `src/lib/raw-signals/types.ts:119`:
```typescript
export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'unavailable'
```

Verify no existing call sites break: `cd F:/Overcurrent/overcurrent && npx tsc --noEmit 2>&1 | grep -E "ConfidenceLevel|confidenceLevel" | head -20`. None of the existing integrations rely on the union being narrower; assignment is the only pattern.

**Step 4: Implement minimal polygon.ts (key-absent path only)**

Create `src/lib/raw-signals/integrations/polygon.ts`:
```typescript
/**
 * Polygon.io integration — Stocks Starter tier (EOD OHLCV + 15-min delayed
 * snapshots + tickers/financials reference).
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   POLYGON_API_KEY (optional — absence is the dominant degradation path
 *                    on day one; integration ships before the key does)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Flat $29/mo unlimited calls. Per-call cost in CostLog is $0.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Always-on per cluster. Resolves cluster.entities through TickerEntityMap;
 * for each resolved ticker, pulls EOD bar + delayed snapshot + reference
 * data, runs Haiku assessment for >2σ price move within 72h of
 * cluster.firstDetectedAt.
 *
 * Writes ONE RawSignalLayer row per cluster (multi-ticker payload in
 * rawContent JSON). Per-entity fan-out happens downstream via
 * onRawSignalWritten → EntitySignalIndex.
 *
 * ── Graceful degradation ──────────────────────────────────────────────
 * Always returns a non-null result. Never throws. Failure modes:
 *   - POLYGON_API_KEY absent → confidenceLevel='unavailable'
 *   - Cluster has no ticker-resolvable entities → 'unavailable'
 *   - Endpoint timeout / HTTP error → partial data with degraded confidence
 *   - Ticker not in Polygon universe → ticker-level error captured in row
 */

import type { IntegrationRunner, IntegrationResult } from '../runner'

export const polygonRunner: IntegrationRunner = async (ctx) => {
  const apiKey = process.env.POLYGON_API_KEY

  if (!apiKey) {
    return {
      rawContent: {
        reason: 'POLYGON_API_KEY absent in this environment',
        clusterEntities: ctx.cluster.entities.slice(0, 10),
      },
      haikuSummary:
        'Financial signal unavailable — Polygon not yet provisioned for this environment.',
      signalSource: 'polygon',
      captureDate: ctx.cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'unavailable' as IntegrationResult['confidenceLevel'],
    }
  }

  // TODO Task 4: ticker resolution + per-endpoint fetches land in subsequent tasks.
  return {
    rawContent: { note: 'Polygon scaffolding incomplete — ticker resolution pending' },
    haikuSummary: 'Financial signal unavailable — implementation incomplete.',
    signalSource: 'polygon',
    captureDate: ctx.cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: 'unavailable' as IntegrationResult['confidenceLevel'],
  }
}
```

**Step 5: Run the test, expect pass**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts`
Expected: 1 passed.

**Step 6: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/types.ts src/lib/raw-signals/integrations/polygon.ts src/__tests__/raw-signals/polygon.test.ts
git commit -m "$(cat <<'EOF'
feat(raw-signals): polygon runner stub with key-absent degradation

Returns 'unavailable' confidence row when POLYGON_API_KEY is missing.
Widens ConfidenceLevel to include 'unavailable' — first-class signal
state per Phase 8 design (always write the row).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Polygon — ticker resolution helper

**Files:**
- Modify: `src/lib/raw-signals/integrations/polygon.ts`
- Modify: `src/__tests__/raw-signals/polygon.test.ts`

**Step 1: Add the failing test**

Append inside the `describe('polygonRunner', ...)` block in the test file:
```typescript
  it('writes unavailable row when no entities resolve to tickers', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([])

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable' as never)
    expect(result!.haikuSummary).toMatch(/no equity-tradable entities/i)
    expect((result!.rawContent as Record<string, unknown>).resolvedTickers).toEqual([])
  })
```

**Step 2: Run, expect failure**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts -t "no entities resolve"`
Expected: FAIL — current stub still returns the "implementation incomplete" message.

**Step 3: Implement ticker resolution helper inside polygon.ts**

Read `prisma/schema.prisma` lines 1051-1066 to confirm `TickerEntityMap` columns. The relevant columns are `ticker`, `entityName`, optional `entityId`. Then add helper above the runner export:

```typescript
import { prisma } from '@/lib/db'

interface ResolvedTicker {
  ticker: string
  entityName: string
}

async function resolveTickersForCluster(entities: string[]): Promise<ResolvedTicker[]> {
  if (entities.length === 0) return []
  const matches = await prisma.tickerEntityMap.findMany({
    where: { entityName: { in: entities } },
    select: { ticker: true, entityName: true },
    take: 25,
  })
  // Dedup by ticker (one entity may map to one ticker, but defensive)
  const seen = new Set<string>()
  const out: ResolvedTicker[] = []
  for (const m of matches) {
    if (seen.has(m.ticker)) continue
    seen.add(m.ticker)
    out.push({ ticker: m.ticker, entityName: m.entityName })
  }
  return out
}
```

Replace the `// TODO Task 4` block in the runner with:
```typescript
  const tickers = await resolveTickersForCluster(ctx.cluster.entities)
  if (tickers.length === 0) {
    return {
      rawContent: {
        resolvedTickers: [],
        clusterEntities: ctx.cluster.entities.slice(0, 10),
      },
      haikuSummary:
        'Financial signal unavailable — no equity-tradable entities resolved for this cluster.',
      signalSource: 'polygon',
      captureDate: ctx.cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'unavailable' as IntegrationResult['confidenceLevel'],
    }
  }

  // TODO Task 5+: per-ticker endpoint fetches.
  return {
    rawContent: { note: 'Per-ticker fetch pending', resolvedTickers: tickers },
    haikuSummary: 'Financial signal unavailable — fetch implementation incomplete.',
    signalSource: 'polygon',
    captureDate: ctx.cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: 'unavailable' as IntegrationResult['confidenceLevel'],
  }
```

**Step 4: Run, expect pass**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts`
Expected: 2 passed.

**Step 5: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/integrations/polygon.ts src/__tests__/raw-signals/polygon.test.ts
git commit -m "$(cat <<'EOF'
feat(polygon): resolve cluster entities via TickerEntityMap

When zero tickers resolve, write 'unavailable' row with clusterEntities
captured for downstream telemetry on TickerEntityMap coverage gaps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Polygon — EOD endpoint fetcher (single-ticker path)

**Files:**
- Modify: `src/lib/raw-signals/integrations/polygon.ts`
- Modify: `src/__tests__/raw-signals/polygon.test.ts`

**Step 1: Add the failing test**

Append:
```typescript
  it('fetches EOD bar for a resolved ticker and writes high-confidence row when endpoints succeed', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entityName: 'Apple Inc' } as never,
    ])
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v2/aggs/ticker/AAPL/prev')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              results: [{ c: 175.5, o: 170.0, h: 176.0, l: 169.0, v: 50_000_000, t: 1734000000000 }],
            }),
        })
      }
      if (url.includes('/v2/snapshot/locale/us/markets/stocks/tickers/AAPL')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ticker: { lastQuote: { p: 176.1, P: 176.2 } } }),
        })
      }
      if (url.includes('/v3/reference/tickers/AAPL')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              results: { name: 'Apple Inc.', sic_description: 'Electronic Computers', market_cap: 2_700_000_000_000, primary_exchange: 'XNAS' },
            }),
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await polygonRunner(baseCtx)
    expect(result!.signalSource).toBe('polygon')
    expect(result!.confidenceLevel).toBe('high')
    const payload = result!.rawContent as Record<string, unknown>
    expect(payload.tickers).toBeDefined()
    const tickers = payload.tickers as Array<{ ticker: string; eod?: unknown; snapshot?: unknown; reference?: unknown }>
    expect(tickers).toHaveLength(1)
    expect(tickers[0].ticker).toBe('AAPL')
    expect(tickers[0].eod).toBeDefined()
    expect(tickers[0].snapshot).toBeDefined()
    expect(tickers[0].reference).toBeDefined()
  })
```

**Step 2: Run, expect failure**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts -t "fetches EOD"`
Expected: FAIL.

**Step 3: Implement per-ticker fetch with three parallel endpoint calls**

Add to `polygon.ts` above the runner (and near top, import `fetchWithTimeout`):
```typescript
import { fetchWithTimeout } from '@/lib/utils'

const POLYGON_BASE = 'https://api.polygon.io'
const POLYGON_TIMEOUT_MS = 8_000

interface TickerData {
  ticker: string
  entityName: string
  eod?: { open: number; high: number; low: number; close: number; volume: number; ts: number }
  snapshot?: { lastPrice: number | null; lastQuote: number | null }
  reference?: { name: string; sicDescription: string | null; marketCap: number | null; primaryExchange: string | null }
  errors: string[]
}

async function fetchEod(ticker: string, apiKey: string): Promise<TickerData['eod'] | undefined> {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?apiKey=${apiKey}`
  try {
    const res = await fetchWithTimeout(url, POLYGON_TIMEOUT_MS)
    if (!res.ok) return undefined
    const data = (await res.json()) as { results?: Array<{ c: number; o: number; h: number; l: number; v: number; t: number }> }
    const r = data.results?.[0]
    if (!r) return undefined
    return { open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, ts: r.t }
  } catch {
    return undefined
  }
}

async function fetchSnapshot(ticker: string, apiKey: string): Promise<TickerData['snapshot'] | undefined> {
  const url = `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}?apiKey=${apiKey}`
  try {
    const res = await fetchWithTimeout(url, POLYGON_TIMEOUT_MS)
    if (!res.ok) return undefined
    const data = (await res.json()) as { ticker?: { lastQuote?: { p?: number; P?: number }; lastTrade?: { p?: number } } }
    return {
      lastPrice: data.ticker?.lastTrade?.p ?? null,
      lastQuote: data.ticker?.lastQuote?.p ?? data.ticker?.lastQuote?.P ?? null,
    }
  } catch {
    return undefined
  }
}

async function fetchReference(ticker: string, apiKey: string): Promise<TickerData['reference'] | undefined> {
  const url = `${POLYGON_BASE}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${apiKey}`
  try {
    const res = await fetchWithTimeout(url, POLYGON_TIMEOUT_MS)
    if (!res.ok) return undefined
    const data = (await res.json()) as { results?: { name?: string; sic_description?: string; market_cap?: number; primary_exchange?: string } }
    const r = data.results
    if (!r) return undefined
    return {
      name: r.name ?? ticker,
      sicDescription: r.sic_description ?? null,
      marketCap: r.market_cap ?? null,
      primaryExchange: r.primary_exchange ?? null,
    }
  } catch {
    return undefined
  }
}

async function fetchTicker(t: ResolvedTicker, apiKey: string): Promise<TickerData> {
  const [eod, snapshot, reference] = await Promise.all([
    fetchEod(t.ticker, apiKey),
    fetchSnapshot(t.ticker, apiKey),
    fetchReference(t.ticker, apiKey),
  ])
  const errors: string[] = []
  if (!eod) errors.push('eod_unavailable')
  if (!snapshot) errors.push('snapshot_unavailable')
  if (!reference) errors.push('reference_unavailable')
  return { ticker: t.ticker, entityName: t.entityName, eod, snapshot, reference, errors }
}
```

Replace the `// TODO Task 5+` block in the runner with:
```typescript
  const tickerData = await Promise.all(tickers.map((t) => fetchTicker(t, apiKey)))

  const allEndpointsHealthy = tickerData.every((t) => t.errors.length === 0)
  const allEndpointsDead = tickerData.every((t) => t.errors.length === 3)

  let confidence: IntegrationResult['confidenceLevel']
  if (allEndpointsDead) confidence = 'unavailable' as IntegrationResult['confidenceLevel']
  else if (allEndpointsHealthy) confidence = 'high'
  else confidence = 'medium'

  // TODO Task 6: Haiku divergence assessment lands here.
  return {
    rawContent: { tickers: tickerData },
    haikuSummary:
      confidence === 'unavailable'
        ? 'Financial signal unavailable — all Polygon endpoints failed for resolved tickers.'
        : `Polygon captured ${tickerData.length} ticker${tickerData.length === 1 ? '' : 's'}; divergence assessment pending.`,
    signalSource: 'polygon',
    captureDate: ctx.cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: confidence,
  }
```

**Step 4: Run, expect pass**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts`
Expected: 3 passed.

**Step 5: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/integrations/polygon.ts src/__tests__/raw-signals/polygon.test.ts
git commit -m "$(cat <<'EOF'
feat(polygon): fetch EOD + snapshot + reference per ticker in parallel

Three endpoints fire in parallel with 8s timeout each. Independent
fallbacks — single endpoint failure degrades that field, not the row.
Confidence: high (all 3 ok), medium (1-2 failed), unavailable (all 3 dead).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Polygon — partial-failure + ticker-not-found tests

**Files:**
- Modify: `src/__tests__/raw-signals/polygon.test.ts`

**Step 1: Add three more tests covering the remaining degradation paths**

Append:
```typescript
  it('writes medium confidence when EOD succeeds but snapshot + reference fail', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entityName: 'Apple Inc' } as never,
    ])
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v2/aggs/')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [{ c: 175, o: 170, h: 176, l: 169, v: 1, t: 1 }] }) })
      }
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('medium')
    const tickers = (result!.rawContent as { tickers: Array<{ errors: string[] }> }).tickers
    expect(tickers[0].errors).toEqual(expect.arrayContaining(['snapshot_unavailable', 'reference_unavailable']))
  })

  it('writes unavailable when ticker is not in Polygon universe (all 3 endpoints 404)', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'NOPE', entityName: 'Nonexistent Inc' } as never,
    ])
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable' as never)
    const tickers = (result!.rawContent as { tickers: Array<{ errors: string[] }> }).tickers
    expect(tickers[0].errors).toHaveLength(3)
  })

  it('writes unavailable when fetch throws on every endpoint (timeout)', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entityName: 'Apple Inc' } as never,
    ])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await polygonRunner(baseCtx)
    expect(result!.confidenceLevel).toBe('unavailable' as never)
  })
```

**Step 2: Run, all pass**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts`
Expected: 6 passed.

**Step 3: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/__tests__/raw-signals/polygon.test.ts
git commit -m "$(cat <<'EOF'
test(polygon): cover partial failure, 404 universe miss, full timeout

Brings Polygon test count to 6 covering the full degradation matrix:
key absent / no ticker resolved / all-3-ok / partial / 404 universe miss
/ full timeout. Each path writes a row — invariant holds in all six.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Polygon — Haiku divergence assessment

**Files:**
- Modify: `src/lib/raw-signals/integrations/polygon.ts`
- Modify: `src/__tests__/raw-signals/polygon.test.ts`

**Step 1: Add the failing test**

```typescript
  it('flags divergence when Haiku returns priceMoveDetected=true', async () => {
    process.env.POLYGON_API_KEY = 'pk_test'
    const { prisma } = await import('@/lib/db')
    vi.spyOn(prisma.tickerEntityMap, 'findMany').mockResolvedValue([
      { ticker: 'AAPL', entityName: 'Apple Inc' } as never,
    ])
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v2/aggs/')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [{ c: 175, o: 170, h: 176, l: 169, v: 1, t: 1 }] }) })
      if (url.includes('/v2/snapshot/')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ticker: { lastTrade: { p: 200 }, lastQuote: { p: 201 } } }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: { name: 'Apple', market_cap: 1 } }) })
    }))

    const anthropic = await import('@/lib/anthropic')
    vi.spyOn(anthropic, 'callClaude').mockResolvedValue({
      text: JSON.stringify({
        priceMoveDetected: true,
        moveDirection: 'up',
        magnitudeSigma: 3.2,
        summary: 'AAPL moved +14% within 48h of cluster firstDetectedAt — corroborates narrative.',
      }),
      costUsd: 0.001,
    } as never)

    const result = await polygonRunner(baseCtx)
    expect(result!.divergenceFlag).toBe(true)
    expect(result!.divergenceDescription).toMatch(/AAPL/i)
    expect(result!.haikuSummary).toMatch(/corroborates|moved/i)
  })
```

**Step 2: Run, expect failure**

**Step 3: Implement Haiku assessment**

Add to `polygon.ts`:
```typescript
import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'

const HAIKU_SYSTEM_PROMPT = `You assess equity price action against a news story.

Given the story and per-ticker EOD + delayed snapshot data, decide whether
any ticker showed a >2σ price move within 72h of the cluster firstDetectedAt.

Reliability rule: with 0 tickers, do NOT flag divergence.

Return JSON only:
{
  "priceMoveDetected": boolean,
  "moveDirection": "up" | "down" | "mixed" | "none",
  "magnitudeSigma": number,
  "summary": "string (1-2 sentences naming the ticker(s) and what moved)"
}`

async function assessDivergence(
  ctx: { cluster: { headline: string; synopsis: string; firstDetectedAt: Date } },
  tickerData: TickerData[],
): Promise<{ priceMoveDetected: boolean; moveDirection: string; magnitudeSigma: number; summary: string } | null> {
  if (tickerData.length === 0) return null
  const userPrompt = `Story headline: ${ctx.cluster.headline}

Story summary: ${ctx.cluster.synopsis.substring(0, 1200)}

Cluster firstDetectedAt: ${ctx.cluster.firstDetectedAt.toISOString()}

Tickers (EOD bar + last snapshot):
${tickerData
  .map(
    (t) =>
      `- ${t.ticker} (${t.entityName}) EOD close=${t.eod?.close ?? 'n/a'}, snapshot last=${t.snapshot?.lastPrice ?? t.snapshot?.lastQuote ?? 'n/a'}, sector=${t.reference?.sicDescription ?? 'n/a'}`,
  )
  .join('\n')}

Assess price move within 72h of firstDetectedAt.`

  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM_PROMPT,
      userPrompt,
      agentType: 'raw_signal_polygon',
      maxTokens: 400,
    })
    return parseJSON(result.text)
  } catch {
    return null
  }
}
```

In the runner, after `tickerData = ...`, replace the `// TODO Task 6` comment block by calling `assessDivergence` and folding its results into the return:
```typescript
  const assessment = await assessDivergence(ctx, tickerData)
  const divergenceFlag = assessment?.priceMoveDetected === true
  const divergenceDescription = divergenceFlag ? assessment!.summary : null

  return {
    rawContent: { tickers: tickerData, assessment },
    haikuSummary:
      confidence === 'unavailable'
        ? 'Financial signal unavailable — all Polygon endpoints failed for resolved tickers.'
        : assessment?.summary ?? `Polygon captured ${tickerData.length} ticker${tickerData.length === 1 ? '' : 's'}; no significant move detected.`,
    signalSource: 'polygon',
    captureDate: ctx.cluster.firstDetectedAt,
    coordinates: null,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel: confidence,
  }
```

**Step 4: Run, expect 7 passed**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/polygon.test.ts`

**Step 5: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/integrations/polygon.ts src/__tests__/raw-signals/polygon.test.ts
git commit -m "$(cat <<'EOF'
feat(polygon): Haiku divergence assessment for >2sigma price moves

Sets divergenceFlag when Haiku reports priceMoveDetected within 72h
of cluster.firstDetectedAt. Mirrors courtlistener pattern: assessment
result captured in rawContent.assessment for downstream review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Register polygon runner

**Files:**
- Modify: `src/lib/raw-signals/integrations/index.ts`

**Step 1: Add the import + registration**

In `index.ts`, near the other Phase 8 placeholders (line 147 area):
- Add import at the appropriate section: `import { polygonRunner } from './polygon'`
- Replace the commented placeholder line:
  ```
  // registerIntegration('financial_equity', polygonEquityRunner)    // Phase 8
  ```
  with:
  ```
  registerIntegration('financial_equity', polygonRunner)
  ```

**Step 2: Run a smoke import to verify registration compiles**

Run: `cd F:/Overcurrent/overcurrent && npx tsc --noEmit 2>&1 | head -30`
Expected: no new errors related to polygon.

**Step 3: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/integrations/index.ts
git commit -m "$(cat <<'EOF'
feat(raw-signals): register polygonRunner for financial_equity signal type

Replaces the Phase 8 placeholder comment. Polygon now runs whenever a
queue entry with signalType=financial_equity is dispatched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Always-on enqueueing — every cluster gets a Polygon queue entry

**Files:**
- Read first: `src/lib/raw-signals/queue.ts` (find the function that builds queue entries per cluster — it's the place that consumes `SIGNAL_CATEGORY_SOURCES` from `types.ts`)
- Modify: `src/lib/raw-signals/queue.ts`
- Create test: `src/__tests__/raw-signals/queue-polygon-always-on.test.ts`

**Step 1: Read existing queue.ts to find the enqueue function name and shape**

Run: `Read F:/Overcurrent/overcurrent/src/lib/raw-signals/queue.ts` and identify the function that calls `prisma.rawSignalQueue.create` per signal type per cluster. Note its name and signature.

**Step 2: Write a failing test**

Create `src/__tests__/raw-signals/queue-polygon-always-on.test.ts` that calls the enqueue function with a cluster whose `signalCategory` is one not listed under `corporate_scandal`/`economic_policy` (e.g. `civil_unrest`, which does NOT include `financial_equity` in `SIGNAL_CATEGORY_SOURCES`). Assert that a `financial_equity` queue row is still created.

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
// import the actual function name discovered in Step 1, e.g.:
import { queueRawSignalEnrichment } from '@/lib/raw-signals/queue'
import { prisma } from '@/lib/db'

afterEach(() => vi.restoreAllMocks())

describe('queueRawSignalEnrichment — Phase 8 always-on rule', () => {
  it('enqueues financial_equity for every cluster regardless of signalCategory', async () => {
    const createSpy = vi.spyOn(prisma.rawSignalQueue, 'create').mockResolvedValue({} as never)
    vi.spyOn(prisma.rawSignalQueue, 'findFirst').mockResolvedValue(null)
    // Stub StoryCluster + Story lookups as needed by the enqueue function
    // (adapt to the function's actual data dependencies discovered in Step 1)

    await queueRawSignalEnrichment(/* args matching its signature */)

    const calls = createSpy.mock.calls
    const enqueuedTypes = calls.map((c) => (c[0] as { data: { signalType: string } }).data.signalType)
    expect(enqueuedTypes).toContain('financial_equity')
  })
})
```

(If `queueRawSignalEnrichment` requires a richer mock surface, expand the stubs as needed — keep them minimal.)

**Step 3: Run, expect failure**

**Step 4: Implement always-on rule**

In `queue.ts`, locate the per-cluster enqueue loop. After the existing category/entity/keyword fan-out, append:

```typescript
// Phase 8 always-on rule: every cluster gets a financial_equity queue entry,
// regardless of signalCategory. Polygon's runner handles graceful degradation
// when no tickers resolve.
const alreadyQueuedFinancialEquity = pendingTypes.has('financial_equity')
if (!alreadyQueuedFinancialEquity) {
  await prisma.rawSignalQueue.create({
    data: {
      storyClusterId: cluster.id,
      umbrellaArcId: cluster.umbrellaArcId ?? null,
      signalType: 'financial_equity',
      triggerLayer: 'category_trigger',
      triggerReason: 'always_on_phase_8',
      status: 'pending',
    },
  })
}
```

(Adapt variable names to match the existing function's locals.)

**Step 5: Run test, expect pass**

**Step 6: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/queue.ts src/__tests__/raw-signals/queue-polygon-always-on.test.ts
git commit -m "$(cat <<'EOF'
feat(raw-signals): always-on financial_equity enqueue per cluster

Phase 8 invariant: every cluster gets a Polygon queue entry, regardless
of signalCategory. Runner-side graceful degradation handles clusters
with no resolvable tickers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Invariant — `assertEveryClusterHasPolygonRow`

**Files:**
- Create: `src/lib/raw-signals/invariants.ts`
- Create test: `src/__tests__/raw-signals/invariants/polygon-row.test.ts`
- Modify: `src/lib/raw-signals/runner.ts` (call assertion at end of `processClusterQueue`)

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { assertEveryClusterHasPolygonRow } from '@/lib/raw-signals/invariants'
import { prisma } from '@/lib/db'

describe('assertEveryClusterHasPolygonRow', () => {
  it('throws when no Polygon row exists for the cluster', async () => {
    vi.spyOn(prisma.rawSignalLayer, 'count').mockResolvedValue(0)
    await expect(assertEveryClusterHasPolygonRow('cluster1')).rejects.toThrow(/polygon row missing/i)
  })

  it('passes when at least one Polygon row exists', async () => {
    vi.spyOn(prisma.rawSignalLayer, 'count').mockResolvedValue(1)
    await expect(assertEveryClusterHasPolygonRow('cluster1')).resolves.toBeUndefined()
  })
})
```

**Step 2: Run, expect failure**

**Step 3: Implement**

Create `src/lib/raw-signals/invariants.ts`:
```typescript
/**
 * Phase 8 hard invariants. Mirror the cost-optimization layer pattern
 * (assertTier1FullDebate, assertContestedClaimDebated). Throw on violation
 * — never silently degrade.
 */
import { prisma } from '@/lib/db'

export async function assertEveryClusterHasPolygonRow(storyClusterId: string): Promise<void> {
  const count = await prisma.rawSignalLayer.count({
    where: { storyClusterId, signalSource: 'polygon' },
  })
  if (count === 0) {
    throw new Error(
      `Phase 8 invariant violation: Polygon row missing for cluster ${storyClusterId}. ` +
        `Every finalized cluster must have at least one RawSignalLayer with signalSource='polygon'.`,
    )
  }
}
```

**Step 4: Wire into runner**

At the end of `processClusterQueue` in `src/lib/raw-signals/runner.ts`, just before the final `return`:
```typescript
  // Phase 8 invariant — fail loud if no polygon row landed.
  // Wrapped in try so an invariant failure logs but doesn't crash the worker;
  // the throw still surfaces in the worker's error log + Datadog alerts.
  try {
    const { assertEveryClusterHasPolygonRow } = await import('./invariants')
    await assertEveryClusterHasPolygonRow(storyClusterId)
  } catch (err) {
    console.error('[raw-signals/runner] INVARIANT VIOLATED:', err instanceof Error ? err.message : err)
  }
```

**Step 5: Run, expect pass**

**Step 6: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/invariants.ts src/__tests__/raw-signals/invariants/polygon-row.test.ts src/lib/raw-signals/runner.ts
git commit -m "$(cat <<'EOF'
feat(invariants): assertEveryClusterHasPolygonRow + runner integration

Throws when a cluster finishes processing without a polygon RawSignalLayer
row. Wired into processClusterQueue with logging fallback so worker stays
alive but the violation surfaces loudly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: PACER — courtlistener triggers PACER queue entry on ≥2 cases

**Files:**
- Modify: `src/lib/raw-signals/integrations/courtlistener.ts`
- Create test: `src/__tests__/raw-signals/courtlistener-pacer-handoff.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { courtListenerRunner } from '@/lib/raw-signals/integrations/courtlistener'
import { prisma } from '@/lib/db'

afterEach(() => vi.restoreAllMocks())

describe('courtlistener → PACER handoff', () => {
  it('enqueues a legal_pacer requires_approval row when ≥2 cases found', async () => {
    // mock fetch to return 3 cases
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        results: [
          { docketNumber: '1:23-cv-001', caseName: 'A', court: 'D.D.C.', dateFiled: '2026-04-01' },
          { docketNumber: '1:23-cv-002', caseName: 'B', court: 'D.D.C.', dateFiled: '2026-04-05' },
          { docketNumber: '1:23-cv-003', caseName: 'C', court: 'D.D.C.', dateFiled: '2026-04-10' },
        ],
      }),
    }))
    // mock Haiku
    const anthropic = await import('@/lib/anthropic')
    vi.spyOn(anthropic, 'callClaude').mockResolvedValue({
      text: JSON.stringify({ caseCount: 3, caseSummary: 'Three cases', corroboratesNarrative: true, addsMissingContext: true, contextDescription: 'X' }),
      costUsd: 0.001,
    } as never)
    const createSpy = vi.spyOn(prisma.rawSignalQueue, 'create').mockResolvedValue({} as never)

    await courtListenerRunner({
      queueId: 'q1',
      storyClusterId: 'cluster1',
      umbrellaArcId: null,
      signalType: 'legal_courtlistener',
      triggerLayer: 'category_trigger',
      triggerReason: 'corporate_scandal',
      approvedByAdmin: false,
      cluster: { id: 'cluster1', headline: 'h', synopsis: 's', firstDetectedAt: new Date(), entities: ['Acme Corp'], signalCategory: 'corporate_scandal' },
    })

    const pacerCreates = createSpy.mock.calls.filter(
      (c) => (c[0] as { data: { signalType: string } }).data.signalType === 'legal_pacer',
    )
    expect(pacerCreates).toHaveLength(1)
    expect((pacerCreates[0][0] as { data: { status: string } }).data.status).toBe('requires_approval')
  })
})
```

**Step 2: Run, expect failure**

**Step 3: Modify courtlistener.ts**

At the end of `courtListenerRunner` (just before the `return` block when cases are found), add:

```typescript
  // Phase 8: when CourtListener metadata returns ≥2 cases, enqueue a
  // PACER queue entry awaiting admin Gate 1 approval at /admin/pacer.
  if (cases.length >= 2) {
    try {
      await prisma.rawSignalQueue.create({
        data: {
          storyClusterId: ctx.storyClusterId,
          umbrellaArcId: ctx.umbrellaArcId,
          signalType: 'legal_pacer',
          triggerLayer: 'category_trigger',
          triggerReason: `courtlistener_returned_${cases.length}_cases`,
          status: 'requires_approval',
          approvalRequestedAt: new Date(),
          estimatedCost: cases.slice(0, 5).length * 1.0, // rough $1/doc estimate; refined at fan-out
        },
      })
    } catch (err) {
      console.warn('[raw-signals/courtlistener] PACER enqueue failed:', err instanceof Error ? err.message : err)
    }
  }
```

(Add `import { prisma } from '@/lib/db'` if not already present in courtlistener.ts.)

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/integrations/courtlistener.ts src/__tests__/raw-signals/courtlistener-pacer-handoff.test.ts
git commit -m "$(cat <<'EOF'
feat(courtlistener): enqueue PACER row when ≥2 cases found

Triggers Phase 8 Gate 1: admin reviews the cluster at /admin/pacer
and either investigates or dismisses. Below 2 cases, no PACER queue
entry — matches courtlistener's existing 'sparse data' threshold.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: PACER pull worker stub + cost threshold resolver

**Files:**
- Create: `src/lib/raw-signals/integrations/pacer.ts`
- Create: `src/lib/raw-signals/pacer-config.ts`
- Create test: `src/__tests__/raw-signals/pacer-config.test.ts`
- Modify: `src/lib/raw-signals/integrations/index.ts` (register `legal_pacer`)

**Step 1: Write failing test for cost threshold**

`src/__tests__/raw-signals/pacer-config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getPacerAutoPullThresholdUsd } from '@/lib/raw-signals/pacer-config'

describe('getPacerAutoPullThresholdUsd', () => {
  let original: string | undefined
  beforeEach(() => { original = process.env.PACER_AUTO_PULL_THRESHOLD_USD })
  afterEach(() => {
    if (original === undefined) delete process.env.PACER_AUTO_PULL_THRESHOLD_USD
    else process.env.PACER_AUTO_PULL_THRESHOLD_USD = original
  })

  it('returns 1.00 by default', () => {
    delete process.env.PACER_AUTO_PULL_THRESHOLD_USD
    expect(getPacerAutoPullThresholdUsd()).toBe(1.0)
  })

  it('returns parsed env value when set', () => {
    process.env.PACER_AUTO_PULL_THRESHOLD_USD = '2.50'
    expect(getPacerAutoPullThresholdUsd()).toBe(2.5)
  })

  it('falls back to 1.00 when env value is non-numeric', () => {
    process.env.PACER_AUTO_PULL_THRESHOLD_USD = 'oops'
    expect(getPacerAutoPullThresholdUsd()).toBe(1.0)
  })
})
```

**Step 2: Run, expect failure**

**Step 3: Implement `pacer-config.ts`**

```typescript
export function getPacerAutoPullThresholdUsd(): number {
  const raw = process.env.PACER_AUTO_PULL_THRESHOLD_USD
  if (!raw) return 1.0
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 1.0
}
```

**Step 4: Implement PACER runner stub**

Create `src/lib/raw-signals/integrations/pacer.ts`:
```typescript
/**
 * PACER runner — STUB.
 *
 * Phase 8 ships the gate scaffolding without the actual PACER document
 * fetch. The real fetch involves a paid PACER login + per-page billing
 * and is intentionally deferred until the gate UI has been exercised
 * against real CourtListener-derived dockets in admin review.
 *
 * Until then this runner writes a single 'unavailable' row noting that
 * the document was approved through the gate but the fetch worker is
 * still stubbed.
 *
 * Hard invariant: this runner is NEVER reached without approvedByAdmin=true
 * — runner.ts already enforces that on signalType='legal_pacer'.
 */
import type { IntegrationRunner, IntegrationResult } from '../runner'

export const pacerRunner: IntegrationRunner = async (ctx) => {
  // Defensive double-check (runner.ts already enforces this; belt + suspenders).
  if (!ctx.approvedByAdmin) {
    throw new Error('PACER runner called without approvedByAdmin=true — gate bypass attempted')
  }

  return {
    rawContent: {
      stub: true,
      note: 'PACER pull worker stubbed in Phase 8. Document approved through the gate; real fetch implementation lands in a follow-on task once gate UI has been exercised end-to-end.',
      gateApprovedAt: new Date().toISOString(),
    },
    haikuSummary: 'PACER document approved through gate — fetch worker stubbed, real document not yet pulled.',
    signalSource: 'pacer',
    captureDate: new Date(),
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: 'unavailable' as IntegrationResult['confidenceLevel'],
  }
}
```

**Step 5: Register in `index.ts`**

Replace:
```
// registerIntegration('legal_pacer', pacerRunner)                 // Phase 8 (GATED)
```
with:
```typescript
import { pacerRunner } from './pacer'
registerIntegration('legal_pacer', pacerRunner)
```

**Step 6: Run tests, expect pass**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/raw-signals/pacer-config.test.ts`

**Step 7: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/pacer-config.ts src/lib/raw-signals/integrations/pacer.ts src/lib/raw-signals/integrations/index.ts src/__tests__/raw-signals/pacer-config.test.ts
git commit -m "$(cat <<'EOF'
feat(pacer): runner stub + auto-pull threshold env resolver

PACER runner registered for legal_pacer queue entries. Stubs the
actual document fetch (deferred until gate UI is exercised end-to-end);
returns 'unavailable' row noting gate approval went through.

PACER_AUTO_PULL_THRESHOLD_USD env defaults to \$1.00; non-numeric values
fall back to default rather than crashing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: PACER server actions — Gate 1 (approveCluster, dismissCluster)

**Files:**
- Create: `src/app/admin/pacer/actions.ts`
- Create test: `src/__tests__/admin/pacer/gate-1-actions.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { approveCluster, dismissCluster } from '@/app/admin/pacer/actions'
import { prisma } from '@/lib/db'

afterEach(() => vi.restoreAllMocks())

describe('approveCluster (Gate 1)', () => {
  it('flips status=running, approvedByAdmin=true, fans out PacerDocumentApproval rows', async () => {
    vi.spyOn(prisma.rawSignalQueue, 'findUnique').mockResolvedValue({
      id: 'q1',
      signalType: 'legal_pacer',
      storyClusterId: 'c1',
      status: 'requires_approval',
      approvedByAdmin: false,
      // simplified — test only inspects what the action reads
    } as never)
    // Suggested dockets surface-of-truth: pull from the linked CourtListener result
    vi.spyOn(prisma.rawSignalLayer, 'findFirst').mockResolvedValue({
      rawContent: {
        cases: [
          { docketNumber: '1:23-cv-001', caseName: 'A v B', court: 'D.D.C.' },
          { docketNumber: '1:23-cv-002', caseName: 'C v D', court: 'D.D.C.' },
        ],
      },
    } as never)
    const updateSpy = vi.spyOn(prisma.rawSignalQueue, 'update').mockResolvedValue({} as never)
    const fanOutSpy = vi.spyOn(prisma.pacerDocumentApproval, 'createMany').mockResolvedValue({ count: 2 } as never)

    await approveCluster('q1', 'admin@example.com')

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'q1' },
      data: expect.objectContaining({ status: 'running', approvedByAdmin: true, approvedOrDeniedBy: 'admin@example.com' }),
    }))
    expect(fanOutSpy).toHaveBeenCalledTimes(1)
    const fanOutData = (fanOutSpy.mock.calls[0][0] as { data: unknown[] }).data
    expect(fanOutData).toHaveLength(2)
  })
})

describe('dismissCluster (Gate 1)', () => {
  it('sets status=skipped with admin email + reason', async () => {
    const updateSpy = vi.spyOn(prisma.rawSignalQueue, 'update').mockResolvedValue({} as never)
    await dismissCluster('q1', 'admin@example.com', 'Not relevant')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'q1' },
      data: expect.objectContaining({ status: 'skipped', dismissalReason: 'Not relevant', approvedOrDeniedBy: 'admin@example.com' }),
    }))
  })
})
```

**Step 2: Run, expect failure (module missing)**

**Step 3: Implement `actions.ts`**

```typescript
'use server'

import { prisma } from '@/lib/db'
import { PACER_DOC_ESTIMATES } from '@/lib/raw-signals/types'

export async function approveCluster(rawSignalQueueId: string, adminEmail: string): Promise<void> {
  const queue = await prisma.rawSignalQueue.findUnique({ where: { id: rawSignalQueueId } })
  if (!queue) throw new Error(`RawSignalQueue ${rawSignalQueueId} not found`)
  if (queue.signalType !== 'legal_pacer') throw new Error(`Queue ${rawSignalQueueId} is not a PACER row`)

  // Pull suggested dockets from the upstream CourtListener result for the same cluster
  const upstream = await prisma.rawSignalLayer.findFirst({
    where: { storyClusterId: queue.storyClusterId, signalSource: 'courtlistener' },
    orderBy: { createdAt: 'desc' },
  })

  type Case = { docketNumber: string; caseName: string; court: string }
  const cases: Case[] =
    (upstream?.rawContent && (upstream.rawContent as { cases?: Case[] }).cases) ?? []

  // Build per-doc approval rows. Default to "full_docket_sheet" estimate if
  // we can't infer doc type from the case metadata.
  const defaultEst = PACER_DOC_ESTIMATES.full_docket_sheet
  const fanOutData = cases.slice(0, 10).map((c) => ({
    rawSignalQueueId,
    docketEntryId: c.docketNumber,
    docketNumber: c.docketNumber,
    court: c.court,
    description: c.caseName,
    pageCount: defaultEst.pages,
    estimatedCostUsd: defaultEst.costUsd,
    recapContribute: true,
  }))

  await prisma.rawSignalQueue.update({
    where: { id: rawSignalQueueId },
    data: {
      status: 'running',
      approvedByAdmin: true,
      approvedAt: new Date(),
      approvedOrDeniedBy: adminEmail,
    },
  })

  if (fanOutData.length > 0) {
    await prisma.pacerDocumentApproval.createMany({ data: fanOutData })
  }
}

export async function dismissCluster(rawSignalQueueId: string, adminEmail: string, reason: string): Promise<void> {
  await prisma.rawSignalQueue.update({
    where: { id: rawSignalQueueId },
    data: {
      status: 'skipped',
      dismissalReason: reason,
      approvedOrDeniedBy: adminEmail,
      approvedAt: new Date(),
    },
  })
}
```

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/app/admin/pacer/actions.ts src/__tests__/admin/pacer/gate-1-actions.test.ts
git commit -m "$(cat <<'EOF'
feat(admin/pacer): Gate 1 server actions — approveCluster + dismissCluster

approveCluster fans out one PacerDocumentApproval row per suggested
docket (capped at 10) using PACER_DOC_ESTIMATES.full_docket_sheet as
the default cost basis. dismissCluster captures admin email + reason.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: PACER server actions — Gate 2 (approveDocument, declineDocument) + auto-pull-below-threshold

**Files:**
- Modify: `src/app/admin/pacer/actions.ts`
- Modify: `src/__tests__/admin/pacer/gate-1-actions.test.ts` → rename to `gate-actions.test.ts` (one suite per file is fine; or add a new file)
- Create test: `src/__tests__/admin/pacer/gate-2-actions.test.ts`

**Step 1: Write failing tests**

`src/__tests__/admin/pacer/gate-2-actions.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { approveDocument, declineDocument } from '@/app/admin/pacer/actions'
import { prisma } from '@/lib/db'

afterEach(() => vi.restoreAllMocks())

describe('approveDocument (Gate 2)', () => {
  it('records approval and triggers PACER pull', async () => {
    vi.spyOn(prisma.pacerDocumentApproval, 'findUnique').mockResolvedValue({
      id: 'doc1', rawSignalQueueId: 'q1', estimatedCostUsd: 5.0, recapContribute: true,
    } as never)
    const updateSpy = vi.spyOn(prisma.pacerDocumentApproval, 'update').mockResolvedValue({} as never)
    // pull worker mocked at the boundary
    const pullModule = await import('@/lib/raw-signals/pacer-pull')
    const pullSpy = vi.spyOn(pullModule, 'pullPacerDocument').mockResolvedValue(undefined)

    await approveDocument('doc1', 'admin@example.com', true)

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'doc1' },
      data: expect.objectContaining({ approvedAt: expect.any(Date), approvedBy: 'admin@example.com', recapContribute: true }),
    }))
    expect(pullSpy).toHaveBeenCalledWith('doc1')
  })
})

describe('declineDocument (Gate 2)', () => {
  it('records decline with reason, no pull', async () => {
    const updateSpy = vi.spyOn(prisma.pacerDocumentApproval, 'update').mockResolvedValue({} as never)
    await declineDocument('doc1', 'admin@example.com', 'Out of scope')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'doc1' },
      data: expect.objectContaining({ declinedAt: expect.any(Date), declinedReason: 'Out of scope' }),
    }))
  })
})
```

Add a third test in the existing Gate 1 suite:
```typescript
  it('auto-approves below-threshold docs immediately on Gate 1 approval', async () => {
    process.env.PACER_AUTO_PULL_THRESHOLD_USD = '10.0'
    vi.spyOn(prisma.rawSignalQueue, 'findUnique').mockResolvedValue({
      id: 'q1', signalType: 'legal_pacer', storyClusterId: 'c1', status: 'requires_approval', approvedByAdmin: false,
    } as never)
    vi.spyOn(prisma.rawSignalLayer, 'findFirst').mockResolvedValue({
      rawContent: { cases: [{ docketNumber: '1:23-cv-001', caseName: 'A v B', court: 'D.D.C.' }] },
    } as never)
    vi.spyOn(prisma.rawSignalQueue, 'update').mockResolvedValue({} as never)
    const createManySpy = vi.spyOn(prisma.pacerDocumentApproval, 'createMany').mockResolvedValue({ count: 1 } as never)
    vi.spyOn(prisma.pacerDocumentApproval, 'findMany').mockResolvedValue([
      { id: 'doc1', estimatedCostUsd: 3.0, recapContribute: true } as never,
    ])
    const pullModule = await import('@/lib/raw-signals/pacer-pull')
    const pullSpy = vi.spyOn(pullModule, 'pullPacerDocument').mockResolvedValue(undefined)
    vi.spyOn(prisma.pacerDocumentApproval, 'update').mockResolvedValue({} as never)

    await approveCluster('q1', 'admin@example.com')

    // The full_docket_sheet estimate is $3 (below the $10 threshold), so auto-approve fires
    expect(createManySpy).toHaveBeenCalled()
    expect(pullSpy).toHaveBeenCalledWith('doc1')
  })
```

**Step 2: Create stub `pacer-pull.ts`**

```typescript
// src/lib/raw-signals/pacer-pull.ts
//
// Triggers the PACER runner via the queue worker for an already-approved
// PacerDocumentApproval row. Stub implementation in Phase 8 — currently
// just creates a child RawSignalQueue entry that the runner will pick up
// and route through the (also stubbed) pacerRunner.
import { prisma } from '@/lib/db'

export async function pullPacerDocument(pacerDocumentApprovalId: string): Promise<void> {
  const doc = await prisma.pacerDocumentApproval.findUnique({
    where: { id: pacerDocumentApprovalId },
    include: { rawSignalQueue: { select: { storyClusterId: true, umbrellaArcId: true } } },
  })
  if (!doc) throw new Error(`PacerDocumentApproval ${pacerDocumentApprovalId} not found`)
  if (!doc.approvedAt) {
    throw new Error(`PacerDocumentApproval ${pacerDocumentApprovalId} not approved — gate bypass attempted`)
  }

  // Phase 8 stub — the real pull worker runs here. For now we just record
  // that the gate fired and the runner would dispatch.
  console.log(
    `[pacer-pull] STUB: would pull docket ${doc.docketNumber}, ` +
      `recapContribute=${doc.recapContribute}, est $${doc.estimatedCostUsd}`,
  )
}
```

**Step 3: Implement `approveDocument` + `declineDocument` + auto-pull-below-threshold in `actions.ts`**

Add to `actions.ts`:
```typescript
import { pullPacerDocument } from '@/lib/raw-signals/pacer-pull'
import { getPacerAutoPullThresholdUsd } from '@/lib/raw-signals/pacer-config'

export async function approveDocument(
  pacerDocumentApprovalId: string,
  adminEmail: string,
  recapContribute: boolean,
): Promise<void> {
  const doc = await prisma.pacerDocumentApproval.findUnique({ where: { id: pacerDocumentApprovalId } })
  if (!doc) throw new Error(`PacerDocumentApproval ${pacerDocumentApprovalId} not found`)
  await prisma.pacerDocumentApproval.update({
    where: { id: pacerDocumentApprovalId },
    data: { approvedAt: new Date(), approvedBy: adminEmail, recapContribute },
  })
  await pullPacerDocument(pacerDocumentApprovalId)
}

export async function declineDocument(
  pacerDocumentApprovalId: string,
  adminEmail: string,
  reason: string,
): Promise<void> {
  await prisma.pacerDocumentApproval.update({
    where: { id: pacerDocumentApprovalId },
    data: { declinedAt: new Date(), declinedReason: reason, approvedBy: adminEmail },
  })
}
```

In `approveCluster`, after `prisma.pacerDocumentApproval.createMany(...)`, append the auto-pull-below-threshold loop:
```typescript
  // Auto-approve below-threshold documents inline
  const threshold = getPacerAutoPullThresholdUsd()
  const created = await prisma.pacerDocumentApproval.findMany({
    where: { rawSignalQueueId, approvedAt: null, declinedAt: null },
  })
  for (const doc of created) {
    if (doc.estimatedCostUsd <= threshold) {
      await prisma.pacerDocumentApproval.update({
        where: { id: doc.id },
        data: { approvedAt: new Date(), approvedBy: `${adminEmail} (auto-below-threshold)` },
      })
      await pullPacerDocument(doc.id)
    }
  }
```

**Step 4: Run all tests, expect pass**

Run: `cd F:/Overcurrent/overcurrent && npx vitest run src/__tests__/admin/pacer/`

**Step 5: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/app/admin/pacer/actions.ts src/lib/raw-signals/pacer-pull.ts src/__tests__/admin/pacer/
git commit -m "$(cat <<'EOF'
feat(admin/pacer): Gate 2 server actions + below-threshold auto-pull

approveDocument records the gate-2 approval and triggers the (stubbed)
PACER pull worker. declineDocument captures reason without firing pull.
approveCluster auto-approves any fan-out doc whose estimated cost falls
at or below PACER_AUTO_PULL_THRESHOLD_USD — admin only sees gate 2 for
expensive pulls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Invariant — `assertNoPacerPullWithoutGateApproval`

**Files:**
- Modify: `src/lib/raw-signals/invariants.ts`
- Create test: `src/__tests__/raw-signals/invariants/pacer-gate.test.ts`
- Modify: `src/lib/raw-signals/pacer-pull.ts` (call assertion)

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { assertNoPacerPullWithoutGateApproval } from '@/lib/raw-signals/invariants'
import { prisma } from '@/lib/db'

describe('assertNoPacerPullWithoutGateApproval', () => {
  it('throws when PacerDocumentApproval has no approvedAt', async () => {
    vi.spyOn(prisma.pacerDocumentApproval, 'findUnique').mockResolvedValue({
      id: 'doc1', approvedAt: null, rawSignalQueue: { approvedByAdmin: true },
    } as never)
    await expect(assertNoPacerPullWithoutGateApproval('doc1')).rejects.toThrow(/gate.*approval/i)
  })

  it('throws when parent RawSignalQueue is not approved', async () => {
    vi.spyOn(prisma.pacerDocumentApproval, 'findUnique').mockResolvedValue({
      id: 'doc1', approvedAt: new Date(), rawSignalQueue: { approvedByAdmin: false },
    } as never)
    await expect(assertNoPacerPullWithoutGateApproval('doc1')).rejects.toThrow(/cluster.*not approved/i)
  })

  it('passes when both gates approved', async () => {
    vi.spyOn(prisma.pacerDocumentApproval, 'findUnique').mockResolvedValue({
      id: 'doc1', approvedAt: new Date(), rawSignalQueue: { approvedByAdmin: true },
    } as never)
    await expect(assertNoPacerPullWithoutGateApproval('doc1')).resolves.toBeUndefined()
  })
})
```

**Step 2: Run, expect failure**

**Step 3: Implement assertion**

Append to `invariants.ts`:
```typescript
export async function assertNoPacerPullWithoutGateApproval(pacerDocumentApprovalId: string): Promise<void> {
  const doc = await prisma.pacerDocumentApproval.findUnique({
    where: { id: pacerDocumentApprovalId },
    include: { rawSignalQueue: { select: { approvedByAdmin: true } } },
  })
  if (!doc) throw new Error(`Phase 8 invariant: PacerDocumentApproval ${pacerDocumentApprovalId} not found`)
  if (!doc.approvedAt) {
    throw new Error(
      `Phase 8 invariant violation: PACER pull attempted without document gate approval (id=${pacerDocumentApprovalId}).`,
    )
  }
  if (!doc.rawSignalQueue?.approvedByAdmin) {
    throw new Error(
      `Phase 8 invariant violation: PACER pull attempted with parent cluster not approved (id=${pacerDocumentApprovalId}).`,
    )
  }
}
```

**Step 4: Wire into `pacer-pull.ts`**

At the top of `pullPacerDocument`, immediately after looking up `doc`:
```typescript
  await (await import('./invariants')).assertNoPacerPullWithoutGateApproval(pacerDocumentApprovalId)
```
(Replace the existing `if (!doc.approvedAt) throw` block with this — the invariant call subsumes it.)

**Step 5: Run, expect pass**

**Step 6: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/lib/raw-signals/invariants.ts src/lib/raw-signals/pacer-pull.ts src/__tests__/raw-signals/invariants/pacer-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(invariants): assertNoPacerPullWithoutGateApproval + pull-worker wire-up

Throws on either gate bypass: missing per-doc approval OR parent cluster
not approved. Wired into pullPacerDocument so any code path that reaches
the pull is checked.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: PACER admin UI — `/admin/pacer/page.tsx`

**Files:**
- Create: `src/app/admin/pacer/page.tsx`
- Read first: `src/app/admin/layout.tsx` and `src/middleware.ts` to confirm admin auth pattern
- Read first: an existing admin page like `src/app/admin/signals/page.tsx` for the shared visual style

**Step 1: Read reference files**

Run Read on:
- `src/app/admin/layout.tsx` — note the chrome
- `src/middleware.ts` — note how admin email gate is enforced
- `src/app/admin/signals/predictive/page.tsx` (or similar) — copy the data-density styling

**Step 2: Build the page**

Create `src/app/admin/pacer/page.tsx`:
```typescript
import { prisma } from '@/lib/db'
import { approveCluster, dismissCluster, approveDocument, declineDocument } from './actions'
import { getPacerAutoPullThresholdUsd } from '@/lib/raw-signals/pacer-config'

// Server Component
export default async function PacerAdminPage() {
  const threshold = getPacerAutoPullThresholdUsd()

  const [clustersAwaitingGate1, docsAwaitingGate2, recentlyCompleted] = await Promise.all([
    // Section 1: clusters awaiting Gate 1
    prisma.rawSignalQueue.findMany({
      where: { signalType: 'legal_pacer', status: 'requires_approval', approvedByAdmin: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // Section 2: per-doc awaiting Gate 2 (above threshold)
    prisma.pacerDocumentApproval.findMany({
      where: { approvedAt: null, declinedAt: null, estimatedCostUsd: { gt: threshold } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // Section 3: recently completed
    prisma.pacerDocumentApproval.findMany({
      where: { OR: [{ approvedAt: { not: null } }, { declinedAt: { not: null } }] },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
  ])

  // Pull cluster context for Section 1 cards
  const clusterIds = clustersAwaitingGate1.map((c) => c.storyClusterId)
  const clusters = await prisma.storyCluster.findMany({
    where: { id: { in: clusterIds } },
    select: { id: true, headline: true, firstDetectedAt: true, signalCategory: true },
  })
  const clusterMap = new Map(clusters.map((c) => [c.id, c]))

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto text-[#E8E6E3]">
      <h1 className="font-serif text-3xl mb-2">PACER review queue</h1>
      <p className="text-sm opacity-70 mb-8">
        Auto-pull threshold: <span className="font-mono">${threshold.toFixed(2)}</span> ·
        Below this, approved-cluster docs pull automatically. Above, each gets a separate confirm.
      </p>

      {/* SECTION 1 */}
      <section className="mb-10">
        <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">── Clusters awaiting Gate 1 ──</h2>
        {clustersAwaitingGate1.length === 0 ? (
          <p className="text-sm opacity-50">None pending.</p>
        ) : (
          <ul className="space-y-3">
            {clustersAwaitingGate1.map((q) => {
              const c = clusterMap.get(q.storyClusterId)
              return (
                <li key={q.id} className="border border-[#222] p-4 rounded">
                  <div className="font-serif text-lg mb-1">{c?.headline ?? '(cluster missing)'}</div>
                  <div className="text-xs opacity-60 mb-2">
                    {c?.signalCategory ?? 'uncategorized'} · cluster {q.storyClusterId.slice(0, 8)} ·
                    queued {q.createdAt.toISOString()} · est ${q.estimatedCost?.toFixed(2) ?? 'n/a'}
                  </div>
                  <p className="text-xs opacity-70 mb-3">Trigger: {q.triggerReason}</p>
                  <div className="flex gap-2">
                    <form action={async () => { 'use server'; await approveCluster(q.id, 'connermhecht13@gmail.com') }}>
                      <button type="submit" className="px-3 py-1 bg-[#2A9D8F] text-black text-sm rounded">Investigate</button>
                    </form>
                    <form action={async (formData: FormData) => {
                      'use server'
                      const reason = String(formData.get('reason') ?? 'Not flagged')
                      await dismissCluster(q.id, 'connermhecht13@gmail.com', reason)
                    }}>
                      <input name="reason" placeholder="Dismissal reason" className="px-2 py-1 bg-[#111] border border-[#333] text-sm" />
                      <button type="submit" className="ml-2 px-3 py-1 bg-[#222] text-sm rounded">Dismiss</button>
                    </form>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* SECTION 2 */}
      <section className="mb-10">
        <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">── Documents awaiting Gate 2 ──</h2>
        {docsAwaitingGate2.length === 0 ? (
          <p className="text-sm opacity-50">None above ${threshold.toFixed(2)} threshold.</p>
        ) : (
          <ul className="space-y-3">
            {docsAwaitingGate2.map((d) => (
              <li key={d.id} className="border border-[#222] p-4 rounded">
                <div className="font-mono text-sm mb-1">{d.docketNumber} · {d.court}</div>
                <div className="text-xs opacity-70 mb-2">{d.description}</div>
                <div className="text-xs opacity-60 mb-3">
                  {d.pageCount} pages · est ${d.estimatedCostUsd.toFixed(2)}
                </div>
                <div className="flex gap-2 items-center">
                  <form action={async (formData: FormData) => {
                    'use server'
                    const recap = formData.get('recap') === 'on'
                    await approveDocument(d.id, 'connermhecht13@gmail.com', recap)
                  }}>
                    <label className="text-xs opacity-70 mr-2"><input type="checkbox" name="recap" defaultChecked /> RECAP</label>
                    <button type="submit" className="px-3 py-1 bg-[#2A9D8F] text-black text-sm rounded">Approve pull</button>
                  </form>
                  <form action={async (formData: FormData) => {
                    'use server'
                    const reason = String(formData.get('reason') ?? 'Declined')
                    await declineDocument(d.id, 'connermhecht13@gmail.com', reason)
                  }}>
                    <input name="reason" placeholder="Decline reason" className="px-2 py-1 bg-[#111] border border-[#333] text-sm" />
                    <button type="submit" className="ml-2 px-3 py-1 bg-[#222] text-sm rounded">Decline</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* SECTION 3 */}
      <section>
        <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">── Recently completed ──</h2>
        {recentlyCompleted.length === 0 ? (
          <p className="text-sm opacity-50">No history yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase opacity-60">
              <tr><th className="text-left py-1">Docket</th><th className="text-left">Status</th><th className="text-right">Est</th><th className="text-right">Actual</th><th className="text-left">Updated</th></tr>
            </thead>
            <tbody>
              {recentlyCompleted.map((d) => (
                <tr key={d.id} className="border-t border-[#222]">
                  <td className="font-mono py-1">{d.docketNumber}</td>
                  <td>{d.approvedAt ? 'approved' : 'declined'}</td>
                  <td className="text-right font-mono">${d.estimatedCostUsd.toFixed(2)}</td>
                  <td className="text-right font-mono">{d.actualCostUsd ? `$${d.actualCostUsd.toFixed(2)}` : '—'}</td>
                  <td className="opacity-60">{d.updatedAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
```

(If `src/middleware.ts` already restricts `/admin/*` to `connermhecht13@gmail.com`, we don't need an extra check inside the page. Otherwise, add a `requireAdmin()` call at the top.)

**Step 3: TypeCheck**

Run: `cd F:/Overcurrent/overcurrent && npx tsc --noEmit 2>&1 | grep -E "admin/pacer" | head -20`
Expected: no errors.

**Step 4: Commit**

```bash
cd F:/Overcurrent/overcurrent
git add src/app/admin/pacer/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin/pacer): /admin/pacer review page (3 sections)

Section 1 — clusters awaiting Gate 1 with Investigate/Dismiss
Section 2 — per-document Gate 2 above threshold with Approve/Decline + RECAP toggle
Section 3 — recently completed (last 20)

Reads PACER_AUTO_PULL_THRESHOLD_USD at request time. All form actions are
inline server actions calling the Phase 8 actions module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Full-suite verification

**Step 1: Run full test suite**

Run: `cd F:/Overcurrent/overcurrent && npm test -- --run 2>&1 | tail -50`
Expected: ≥391 tests pass (380 prior + 11 new). If any pre-existing tests broke, debug at root cause; do NOT mark Phase 8 done.

**Step 2: Run TypeScript check**

Run: `cd F:/Overcurrent/overcurrent && npx tsc --noEmit 2>&1 | tail -30`
Expected: zero new errors. Pre-existing errors (if any) are out of scope but should be noted.

**Step 3: Run lint**

Run: `cd F:/Overcurrent/overcurrent && npm run lint 2>&1 | tail -30`
Expected: clean, or only pre-existing warnings.

**Step 4: Build smoke**

Run: `cd F:/Overcurrent/overcurrent && npm run build 2>&1 | tail -40`
Expected: build succeeds; `/admin/pacer` route appears in the route table.

---

## Task 18: Manual smoke — seed fake data and view `/admin/pacer`

**Files:**
- Create: `scripts/phase-8-seed-pacer-fixtures.ts` (one-off; not committed)

**Step 1: Write a tiny seed script**

```typescript
// scripts/phase-8-seed-pacer-fixtures.ts
import { prisma } from '../src/lib/db'

async function main() {
  // Find any existing storyCluster to attach to
  const cluster = await prisma.storyCluster.findFirst({ orderBy: { firstDetectedAt: 'desc' } })
  if (!cluster) { console.error('No StoryCluster in DB; create one first.'); return }

  // Pretend CourtListener returned 3 cases for this cluster
  await prisma.rawSignalLayer.create({
    data: {
      storyClusterId: cluster.id,
      signalType: 'legal_courtlistener',
      signalSource: 'courtlistener',
      captureDate: new Date(),
      rawContent: {
        cases: [
          { docketNumber: '1:26-cv-001', caseName: 'United States v. Acme Corp.', court: 'D.D.C.' },
          { docketNumber: '1:26-cv-002', caseName: 'SEC v. Acme Corp.', court: 'S.D.N.Y.' },
        ],
      } as never,
      haikuSummary: 'Two federal cases match cluster entities.',
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'medium',
    },
  })

  // Enqueue PACER row
  await prisma.rawSignalQueue.create({
    data: {
      storyClusterId: cluster.id,
      signalType: 'legal_pacer',
      triggerLayer: 'category_trigger',
      triggerReason: 'courtlistener_returned_2_cases',
      status: 'requires_approval',
      approvalRequestedAt: new Date(),
      estimatedCost: 6.0,
    },
  })

  console.log(`Seeded PACER fixture for cluster ${cluster.id.slice(0, 8)}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

**Step 2: Run seed**

Run: `cd F:/Overcurrent/overcurrent && npx tsx scripts/phase-8-seed-pacer-fixtures.ts`
Expected: seed line printed.

**Step 3: Boot dev server and view the page**

Use the preview tool (per harness):
- `preview_start` with `cwd: F:/Overcurrent/overcurrent`, command `npm run dev`
- `preview_eval`: navigate to `/admin/pacer`
- `preview_snapshot`: confirm Section 1 shows the seeded cluster

**Step 4: Click "Investigate"**

- `preview_click` on the Investigate button
- `preview_snapshot`: confirm Section 1 row disappears, Section 2 shows up to 2 docs above threshold (or none if `full_docket_sheet` $3 < $1 default… wait — $3 > $1 so they appear in Section 2)

**Step 5: Click "Approve pull" on one doc**

- `preview_click` Approve pull
- `preview_snapshot`: confirm Section 3 now shows the doc as approved

**Step 6: Capture screenshot for the user**

`preview_screenshot` of the final state.

**Step 7: Tear down dev server**

`preview_stop`

**Step 8: Delete the seed script (not committed) — or keep it under .gitignored scripts**

---

## Task 19: Phase 8 sign-off

**Step 1: Final git status**

Run: `cd F:/Overcurrent/overcurrent && git log --oneline -20`
Expected: ~17 commits added since the design-doc commit, all Phase 8.

**Step 2: Tag**

```bash
cd F:/Overcurrent/overcurrent && git tag phase-8-complete -m "Phase 8: Polygon scaffolding + PACER double-gate scaffolding complete"
```

**Step 3: Report to user**

Summarize:
- Tests added: 11 (6 polygon + 1 always-on enqueue + 1 invariant + 3 pacer-config + 3 gate-1 + 2 gate-2 + 3 invariant — total ~19, recount before reporting)
- Files created/modified
- Smoke screenshot URL (from Task 18)
- Open follow-ups: real PACER pull worker, monthly Polygon cost accrual, optional `requireAdmin()` re-confirm at page level if middleware coverage is weaker than expected
- Confirm: "Stop. Show results before Phase 9." per master-prompt instructions.

---

## Done criteria recap

1. `prisma migrate` clean with `PacerDocumentApproval` table
2. `polygon.ts` registered, returns a row in all six degradation paths
3. `pacer.ts` registered as stub; never callable without both gates
4. `/admin/pacer` renders three sections with working server actions
5. Full test suite passes (≥391 tests)
6. Hard invariants both wired and demonstrably throw
7. Manual smoke captured a screenshot
8. Stop. Report. Wait for user before Phase 9.
