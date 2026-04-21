# 2026-04-21 — Phase 12: Raw Data Visualization Pipeline

> **Status:** Planning document only — not yet implemented.
> **Depends on:** Phase 2 (Gap Score computation) producing real scores against real signals.
> **Do not start before:** Gap Score is computing above-threshold fires and the related Phase 2.5 paper-trading validation layer ([2026-04-21-phase-11-paper-trading-validation-layer.md](2026-04-21-phase-11-paper-trading-validation-layer.md)) scope is defined.
> **Sibling planning docs for Phase 2.5:** this file (visualization) + the Phase 11 paper-trading spec. Both can execute in parallel once Phase 2 is live; they share no dependencies.
>
> This document captures the Part 12 design verbatim from the v2 master prompt addition.

---

# PART 12 — RAW DATA VISUALIZATION PIPELINE

**Context for Claude Code:** This is a new part of the v2 master prompt, added after Part 11. It defines a visualization pipeline that automatically generates branded, shareable images from raw data (satellite, AIS, CFTC, SEC filings, congressional trades, macro releases, price charts) whenever a Gap Score fires. These images serve two surfaces: (a) the public social content engine (Twitter, Reddit, Substack), and (b) the paid dashboard "Evidence" tab.

**This is Phase 2.5 work.** It depends on Phase 2 (Gap Score computation) being live and producing real scores. Do NOT start before Gap Score is computing.

**Why this matters:** The visualization pipeline is the product's single biggest competitive differentiator. Every competitor (Permutable, Unusual Whales, Whale Alert, SpotGamma) posts interpretations of data. Overcurrent posts the raw data directly — satellite images, AIS screenshots, Form 4 filings, CFTC charts — branded, annotated, and sourced. This content category cannot be replicated by competitors who don't ingest the underlying data. It's the moat.

---

## 12.0 — ARCHITECTURAL PRINCIPLE

**One pipeline, two surfaces:**

```
Gap Score fires
  ↓
Visualization Pipeline runs
  ↓
Images generated + stored + URL'd
  ↓
         ┌─────────────────────────────┐
         ↓                             ↓
  Social content queue          Paid dashboard
  (draft tweets, Substack,      (Evidence tab on
   Reddit DD templates)          asset detail pages)
```

Every visual asset serves both surfaces. The same satellite image embedded in the paid dashboard is what gets posted to Twitter. No duplicate effort, no content drift between what users pay for and what the public sees.

**Brand discipline:** Every image is visually branded. When someone screenshots an Overcurrent image and posts it without attribution, the brand is still visible. Template discipline is load-bearing.

---

## 12.1 — VISUALIZATION TYPES (WHAT WE GENERATE)

For each Gap Score fire, the pipeline generates a set of images based on which stream(s) drove the divergence. Each image type has a templated format, a versioned template file, and known data inputs.

### 12.1.1 — Ground Truth stream visualizations

**GT-V1: SEC Form 4 filing card**

Generated when: T-GT1 (SEC Form 4 - large insider transaction) trigger fires.

Content:
- Screenshot of the relevant Form 4 filing excerpt (from SEC EDGAR, rendered via headless browser)
- Highlighted fields: filer name, transaction date, dollar amount, % of holdings
- Annotated timeline showing other insider transactions in prior 90 days
- Company logo (optional, from public sources)
- Overcurrent brand watermark + source citation

Use cases: Twitter card, Reddit DD embed, Substack essay illustration, dashboard Evidence tab.

**GT-V2: SEC 13D/G activist stake card**

Generated when: T-GT2 fires.

Content:
- Filing excerpt with ownership percentage highlighted
- Prior quarter ownership for the filer (shows accumulation)
- Comparison to other large holders (top 10 institutional)
- Source citation

**GT-V3: CFTC COT positioning chart**

Generated when: T-GT4 fires.

Content:
- Stacked chart of managed money long/short positions over 52 weeks
- Current week highlighted with arrow showing WoW delta
- Commercial hedger positioning as secondary line
- Net position callout box with delta magnitude
- Overlay with spot price (right axis) for context

**GT-V4: Price move anomaly chart**

Generated when: T-GT5 or T-GT6 fires.

Content:
- Candlestick chart (intraday or daily depending on trigger)
- Historical volatility band (1σ and 2σ shaded)
- Current move highlighted as a breakout
- Volume subplot
- Asset metadata (ticker, current price, % change, time)

**GT-V5: Maritime AIS anomaly map**

Generated when: T-GT7 (maritime zone anomaly) fires.

Content:
- Mapbox Static API render of the zone with ship positions as dots
- Color coding: tankers in red, bulk carriers in blue, container ships in green, LNG carriers in purple
- Ship count in top-left callout
- Baseline comparison: "14-day avg: X, current: Y (Z-score: +2.3)"
- Zone boundary polygon outlined
- Timestamp
- Time-lapse GIF variant for high-severity anomalies (show last 72 hours as animated frames)

**GT-V6: Inventory release surprise chart**

Generated when: T-GT8 (EIA/USDA commodity inventory) fires.

Content:
- Bar chart of last 52 weekly inventory changes
- 5-year seasonal range shaded
- Current release bar highlighted with surprise magnitude annotation
- Consensus expectation marker
- Asset impact callout (which commodity ticker and direction)

**GT-V7: Macro surprise chart**

Generated when: T-GT9 (macro data release surprise) fires.

Content:
- FRED chart of historical series (last 5 years)
- Current release highlighted with large callout
- Consensus expectation marker
- Surprise magnitude as z-score annotation
- Historical distribution of surprises (histogram in corner)
- Affected assets list

**GT-V8: Congressional trade disclosure card**

Generated when: T-GT10 fires.

Content:
- Screenshot of the Congressional periodic transaction report excerpt
- Member name, committee memberships, transaction details highlighted
- Relevant committee jurisdiction callout if applicable ("Member of Energy Committee, trading XOM")
- Other recent trades by same member for context
- Source citation (Clerk of the House or Senate Ethics filing)

**GT-V9: Satellite imagery diff**

Generated when: satellite data is part of a Gap Score decomposition (typically for commodity ground truth signals).

Content:
- Side-by-side Sentinel-2 imagery: 30 days ago vs. current
- Annotated region of interest (storage facility, port, refinery)
- Change detection overlay (difference visualization)
- Metric callout: "Est. inventory change: +12%" (derived from relative change methodology from our Path B approach)
- Source citation with date, lat/long, Sentinel scene ID

**GT-V10: Options flow card (when Polygon business tier is unlocked)**

Deferred until Polygon business tier is active. Placeholder in the pipeline.

### 12.1.2 — Narrative stream visualizations

**N-V1: Article volume spike chart**

Generated when: T-N1 fires.

Content:
- Line chart of articles per hour over past 72 hours
- Rolling 7-day baseline shown as shaded band
- Current spike annotated with standard deviations above mean
- Top 3 headlines from the spike period listed below chart (with outlet names and timestamps)

**N-V2: Cross-outlet amplification matrix**

Generated when: T-N2 fires.

Content:
- Grid of outlet logos with headline snippets (shows same story hitting multiple outlets)
- Time-to-coverage annotation (first outlet timestamp through latest)
- Regional distribution map (if story has geographic spread pattern)
- "N outlets in 30 minutes" callout

**N-V3: Wire headline event card**

Generated when: T-N3 fires.

Content:
- The headline prominently rendered in editorial style
- Source outlet, byline, timestamp
- Event type classification (earnings, M&A, regulatory, etc.)
- Related signals from same 24h window
- Asset context (current price, recent move)

### 12.1.3 — Psychological stream visualizations

**P-V1: Cashtag velocity chart**

Generated when: T-P1 fires.

Content:
- Line chart of mentions per hour over past 72h across Twitter, Reddit, Telegram
- Separate lines per platform
- Rolling 14-day baseline shaded
- Current spike annotated with z-score
- Platform breakdown pie chart in corner

**P-V2: Engagement acceleration chart**

Generated when: T-P2 fires.

Content:
- Scatter plot or curve of individual post engagement over time
- Acceleration curve overlay
- Top 3 viral posts embedded as screenshots (usernames redacted for public version, visible for admin/paid)
- Sentiment distribution of those posts (direction histogram)

**P-V3: Cross-platform trend card**

Generated when: T-P3 fires.

Content:
- Three panels side-by-side: Twitter / Reddit / Telegram
- Mention velocity per platform with baseline comparison
- Top post from each platform (screenshot)
- Synchronicity timestamp showing when the cross-platform trend activated

### 12.1.4 — Gap Score aggregate visualizations

**G-V1: Three-stream decomposition panel**

Generated for every Gap Score above threshold.

Content:
- Three vertical gauges (Narrative / Psychological / Ground Truth)
- Each showing -1 to +1 scalar with confidence indicator
- Pairwise divergence bars below
- Overall Gap Score number prominent
- FDS (Financial Divergence Sub-Score) called out separately
- Asset metadata header

**G-V2: Hot list snapshot**

Generated hourly from HotListSnapshot table.

Content:
- Ranked table of top 10 Gap Scores right now
- Each row: ticker, Gap Score, dominant stream, one-line thesis
- Color-coded score cells (green/amber/orange/red per score tier)
- Timestamp prominent
- "Where the market's story doesn't match the data"

**G-V3: Historical Gap Score trend**

Generated for case study pages and asset detail pages.

Content:
- Line chart of Gap Score over time for a specific asset (30/90/180/365 day range)
- Event markers overlaid (earnings, CFTC releases, major news)
- Score bucket color bands in background
- Forward outcome annotations if case study

**G-V4: Propagation map (retained from legacy concept)**

Generated when narrative stream fires a cross-outlet amplification trigger.

Content:
- World map showing where a story originated and how it spread
- Animated GIF variant showing spread over time
- Outlet clustering by country/region
- Time-to-global annotation

**G-V5: Asset category heatmap**

Generated daily for content.

Content:
- Grid of 30+ assets colored by current Gap Score
- Shows at a glance which asset classes are divergent
- Visual pattern recognition aid

---

## 12.2 — BRAND TEMPLATE SYSTEM

All visualizations use a shared brand template. Templates are versioned the same way sentiment prompts are versioned.

### 12.2.1 — Visual language

**Colors:**
- Background: `#0A0E1A` (deep navy, matches existing dark editorial theme)
- Primary accent: `#FF6B35` (orange, divergence flag color)
- Secondary accent: `#2EC4B6` (teal, for positive/data-confirming elements)
- Text primary: `#F8F9FA` (off-white)
- Text secondary: `#94A3B8` (muted slate)
- Gap Score gradient: green (#10B981) → amber (#F59E0B) → orange (#F97316) → red (#EF4444)

**Typography:**
- Headlines: Playfair Display (already in design system)
- Body/data labels: IBM Plex Sans (already in design system)
- Monospace (tickers, numbers): IBM Plex Mono
- All fonts self-hosted in pipeline (no CDN dependency at render time)

**Brand elements on every image:**
- Overcurrent wordmark in bottom-left corner
- Domain URL (`overcurrent.news` for public, `overcurrent.app` for paid)
- Source citation in bottom-right corner (outlet name, SEC, CFTC, Sentinel, etc.)
- Timestamp (always UTC with local-time parenthetical)

**Output dimensions:**
- Twitter card: 1200 × 628 (16:9)
- Twitter square: 1200 × 1200
- Reddit/LinkedIn: 1200 × 628
- Substack hero: 1456 × 816
- Instagram: 1080 × 1080 (square) and 1080 × 1350 (portrait)
- Dashboard embed: 800 × 500 (smaller, rendered for paid UI)

Every visualization type has a default output dimension and supports alternate dimensions via config.

### 12.2.2 — Template file structure

```
src/lib/visualization/
  templates/
    ground-truth/
      sec-form-4.tsx              // React component rendered to image
      sec-13d-g.tsx
      cftc-cot.tsx
      price-move.tsx
      maritime-ais.tsx
      inventory-release.tsx
      macro-surprise.tsx
      congressional-trade.tsx
      satellite-diff.tsx
    narrative/
      article-volume-spike.tsx
      cross-outlet-matrix.tsx
      wire-headline.tsx
    psychological/
      cashtag-velocity.tsx
      engagement-acceleration.tsx
      cross-platform-trend.tsx
    gap-score/
      three-stream-decomposition.tsx
      hot-list-snapshot.tsx
      gap-score-trend.tsx
      propagation-map.tsx
      category-heatmap.tsx
    shared/
      brand-footer.tsx             // Overcurrent logo + domain + timestamp
      data-source-citation.tsx    // source attribution formatter
      gap-score-gauge.tsx          // reusable gauge component
      color-tokens.ts              // shared color palette
      typography.ts                // font loading + text components
  renderer/
    browser-renderer.ts            // Playwright-based HTML → PNG/GIF
    static-renderer.ts             // Pillow-based Python fallback for simpler templates
    render-queue.ts                // BullMQ integration
  storage/
    image-storage.ts               // Supabase Storage wrapper
    url-generator.ts               // CDN-friendly signed URLs
  output-sizes.ts                  // dimension configs per platform
```

### 12.2.3 — Template versioning

Each template file starts with:

```typescript
export const TEMPLATE_VERSION = 'sec-form-4-v1.0';
```

Templates are tracked in a `TemplateVersion` table (add to Phase 2.5 schema):

```prisma
model TemplateVersion {
  id            String   @id @default(cuid())
  name          String   // "sec-form-4", "maritime-ais", etc.
  version       String
  activeFrom    DateTime
  activeUntil   DateTime?

  exampleRenderUrl String?  // stored example for reference

  @@unique([name, version])
  @@index([name, activeFrom])
}
```

When the pipeline renders an image, the template version used is logged to the GeneratedVisualization record (see 12.3). This means: if you update a template and want to see what it used to look like, you can. It also means A/B testing templates is possible by gating versions.

---

## 12.3 — DATABASE SCHEMA ADDITIONS

Add to Prisma migration (Phase 2.5):

```prisma
model GeneratedVisualization {
  id                String   @id @default(cuid())
  gapScoreId        String
  gapScore          GapScore @relation(fields: [gapScoreId], references: [id])

  visualizationType String   // "sec-form-4" | "maritime-ais" | "three-stream-decomposition" | etc.
  templateVersion   String

  outputFormat      String   // "png" | "gif" | "svg"
  outputDimension   String   // "1200x628" | "1200x1200" | etc.
  storageKey        String   // Supabase Storage key
  publicUrl         String?  // cached public URL (null for gated)

  dataPayloadHash   String   // hash of input data — allows cache lookup for duplicate renders
  renderedAt        DateTime @default(now())
  renderDurationMs  Int?
  renderCostCents   Int?     // browser CPU time + storage cost estimate

  metadata          Json?    // dimensions, annotations, source attributions, etc.

  @@index([gapScoreId, visualizationType])
  @@index([dataPayloadHash])  // for cache hits
  @@index([renderedAt])
}

model TemplateVersion {
  id            String   @id @default(cuid())
  name          String
  version       String
  activeFrom    DateTime
  activeUntil   DateTime?
  exampleRenderUrl String?

  @@unique([name, version])
  @@index([name, activeFrom])
}
```

---

## 12.4 — RENDERING ARCHITECTURE

### 12.4.1 — Browser-based rendering (primary)

Most templates render via Playwright headless browser:

```
Template React component → HTML + CSS → Playwright screenshot → PNG
```

Why browser-based:
- React components are expressive and match the existing dashboard codebase
- CSS gives full design flexibility (gradients, shadows, fonts, SVG annotations)
- Animations for GIF variants supported via CSS + Playwright frame capture
- Maintenance: design system changes propagate automatically

Implementation:
- Playwright runs in a dedicated worker (not the main API process)
- Lazy-launch: Playwright instance started per render batch, shut down when idle
- Concurrency: 3 simultaneous renders per worker (configurable)
- Cache: keyed on `dataPayloadHash` — if identical render was produced in last 24h, return cached URL

### 12.4.2 — Python/Pillow rendering (fallback)

For ultra-simple cards where browser overhead is wasteful:
- Single-data-point cards
- Screenshot overlays (putting annotations on existing images)
- Low-complexity charts

`src/lib/visualization/renderer/static-renderer.py` — keep small. Only used when browser rendering is clear overkill.

### 12.4.3 — External API renderers

**Mapbox Static API** — for maritime AIS maps and propagation maps. Cheap, handles geographic rendering cleanly. $0.50 per 1000 requests.

**Sentinel Hub Process API** — for satellite imagery retrieval. Free tier generous enough for v1.

**Chart rendering libraries (imported into browser renderer):**
- Chart.js for simple financial charts
- Plotly for statistical distributions
- D3.js for custom visualizations (heatmaps, force-directed layouts)

### 12.4.4 — Queue integration

New BullMQ queue: `visualization-render`

```typescript
// Producer: runs after every Gap Score save above threshold
// Consumer: pipeline-service/workers/visualization.ts
// Concurrency: 3
// Retry: 2 attempts, 10s backoff
// Timeout: 45s per render (hard kill after)
```

Job payload:
```typescript
interface VisualizationJob {
  gapScoreId: string;
  visualizationTypes: string[];  // which templates to render
  outputDimensions: string[];     // which output sizes
  priority: 'realtime' | 'standard' | 'backfill';
}
```

---

## 12.5 — STORAGE

**Supabase Storage** for image files.

**Bucket structure:**
```
overcurrent-visualizations/
  gap-score/
    {gapScoreId}/
      {visualizationType}/
        {templateVersion}/
          {outputDimension}.{png|gif}
```

**URL generation:**

Public visualizations (for overcurrent.news, social posts): Supabase public URL, cached via CDN.

Gated visualizations (for paid dashboard, higher-resolution variants): signed URLs with 1-hour expiry, generated on-demand per user session.

Example:
- Public: `https://storage.overcurrent.news/gap-score/abc123/sec-form-4/v1.0/1200x628.png`
- Gated: `https://storage.overcurrent.app/signed/…token…/gap-score/abc123/sec-form-4/v1.0/2400x1256.png`

**Storage cost estimate:**
- Average image: ~150KB
- Expected volume: ~500 renders/day × 5 images each = 2,500 images/day = 75K/month
- Monthly storage growth: ~11GB/month
- Cost: ~$2-5/month on Supabase Storage (generous free tier covers first several months)

**Retention policy:**
- Public visualizations: kept indefinitely (they're linked from social posts)
- Gated high-res variants: 90 days, then purged (regeneratable on demand)
- Cache entries: 24 hours, then purged

---

## 12.6 — INTEGRATION WITH GAP SCORE COMPUTATION

When a Gap Score is saved (Phase 2 work), the save hook triggers visualization rendering:

```typescript
// src/lib/gap-score/post-save.ts
async function onGapScoreSaved(gapScore: GapScore) {
  // Existing work: alerts, hot list update, etc.

  // New: queue visualization rendering
  if (gapScore.gapScore >= VISUALIZATION_THRESHOLD) {  // e.g., 60
    await enqueueVisualizationRender({
      gapScoreId: gapScore.id,
      visualizationTypes: determineVisualizationTypes(gapScore),
      outputDimensions: ['1200x628', '1200x1200'],  // Twitter card + square
      priority: gapScore.triggerType === 'event' ? 'realtime' : 'standard',
    });
  }
}
```

`determineVisualizationTypes()` examines the Gap Score decomposition and returns the list of relevant templates:

```typescript
function determineVisualizationTypes(gapScore: GapScore): string[] {
  const types: string[] = ['three-stream-decomposition'];  // always render this

  // Add templates based on which signals are present
  if (gapScore.contributingSignalIds.some(id => isSecForm4(id))) {
    types.push('sec-form-4');
  }
  if (gapScore.contributingSignalIds.some(id => isCftcRelease(id))) {
    types.push('cftc-cot');
  }
  if (gapScore.contributingSignalIds.some(id => isMaritimeAnomaly(id))) {
    types.push('maritime-ais');
  }
  // ... etc for each trigger type

  return types;
}
```

---

## 12.7 — INTEGRATION WITH SOCIAL CONTENT ENGINE

When a visualization finishes rendering, it becomes available to the social content draft generator (Phase 11's Twitter automation scope).

Draft tweet generator pulls:
- Gap Score metadata (asset, score, decomposition)
- Related GeneratedVisualization records
- Attaches primary image(s) to the draft

Admin review queue at `/admin/content/drafts` shows:
- Draft tweet text
- Attached image preview
- Edit/approve/reject controls
- "Regenerate image" button (re-runs specific template for edge cases)
- "Try alternate template" selector

### 12.7.1 — Image-first posting pattern

For Overcurrent specifically (differentiator vs. competitors): draft tweets prioritize the image as the content, with minimal caption. Tweet drafting prompt should follow this pattern:

```
System prompt:
You are drafting social posts for Overcurrent. The image IS the content.
Your caption should be MINIMAL — 1-3 short lines maximum.
Never over-explain what the image shows. The image speaks for itself.

Examples of good posts:
---
Image: Form 4 filings for 4 TSLA executives, $23M total sold in 14 days

Caption:
TSLA insiders. Last two weeks.

$TSLA
---

Image: Maritime AIS screenshot showing 17 tankers at Fujairah vs. 14-day avg of 6

Caption:
Fujairah. Right now.

$WTI $BZ
---

Image: CFTC COT chart showing managed money shift on wheat

Caption:
Managed money, wheat. Largest weekly shift in 14 months.

$ZW
```

This is a fundamentally different voice than the competition. Minimalism signals data confidence.

### 12.7.2 — Alt text generation

Every posted image needs accessibility alt text. Sonnet call generates alt text per image with prompt:

```
Describe this financial visualization in 150-200 characters for a screen reader user.
Include: chart type, asset/ticker, time period, the key pattern or data point.
Be specific. Numbers matter.
```

Alt text stored in GeneratedVisualization.metadata.

---

## 12.8 — INTEGRATION WITH PAID DASHBOARD

The Evidence tab on the asset detail page (`/dashboard/entity/[id]`) shows all GeneratedVisualization records for that entity's Gap Scores.

Layout:
- Most recent Gap Score's visualizations at the top
- Each visualization rendered inline with:
  - Full-resolution image
  - Source citation
  - Data payload expandable view (raw JSON of contributing signals)
  - "Download as PNG" link (paid feature)
  - "Share" link (generates pre-formatted tweet with image attached — opens Twitter intent URL)

This turns every Gap Score into a user-facing research artifact, not just a number.

### 12.8.1 — Dashboard-specific variants

The paid dashboard gets higher-resolution, more-detailed variants:
- `1200x628` is the social share variant (publicly generated)
- `2400x1256` is the dashboard high-res variant (gated, signed URLs)
- Additional data layers shown on paid variants (historical context, statistical distributions, decomposition detail)

---

## 12.9 — CONTENT SAFETY AND DATA SOURCE COMPLIANCE

Every visualization includes source attribution. Compliance with data provider terms:

**SEC filings:** Public records, fair use for summary. Always cite "Source: SEC EDGAR" with direct filing URL.

**CFTC data:** Public, attribution required. "Source: CFTC Commitments of Traders, [release date]."

**USDA / EIA / FRED:** Public, attribution required.

**Congressional disclosures:** Public records from Clerk of House / Secretary of Senate / House Ethics. Attribution required.

**Maritime AIS (Datalastic):** Commercial license. Check ToS for image derivation and social posting — generally allowed with attribution, but verify. Cite "AIS data via Datalastic."

**Sentinel satellite imagery:** Open data under Copernicus license. Attribution: "Contains modified Copernicus Sentinel data [year]."

**News articles and social content:** Never reproduce full text or full-resolution screenshots. Summaries, brief excerpts with attribution, or metadata-only references. Fair use boundaries apply.

**Paywalled content:** Never screenshot paywalled articles. Reference by URL and headline only.

`src/lib/visualization/compliance/source-attributions.ts` — centralized attribution strings per data source, loaded into every template's footer.

---

## 12.10 — COST MODEL

**Per-render costs:**

- Playwright browser time: ~2-5 seconds per image, negligible cost on existing infrastructure
- Mapbox Static API: $0.0005 per map render (maritime only, ~50 renders/day = $0.75/month)
- Sentinel Hub API: free tier, covers v1 volume
- Supabase Storage: ~$0.02/GB/month after free tier, storage grows ~11GB/month
- Sonnet for alt text generation: ~$0.005 per image, 2500 images/day = $375/month (HIGH — see cost discipline below)

**Cost discipline rules:**

1. **Alt text generation uses Haiku, not Sonnet.** Saves 5x. Reduces $375/month to $75/month.
2. **Cache aggressively.** Same data payload hash = same image. Never re-render identical inputs.
3. **Batch alt text generation.** Multiple images in one Haiku call (structured output).
4. **Lazy gated variant generation.** High-res dashboard variants only rendered when a paid user views the Evidence tab — don't pre-render all sizes for every Gap Score.

**Realistic monthly cost addition:**
- Mapbox: ~$0-5
- Supabase Storage: ~$5-15
- Haiku alt text: ~$75
- Playwright compute: negligible (runs on existing Vercel/Railway)
- **Total: ~$80-100/month incremental**

Fits within the $850-1150 baseline from v2 Part 7.

---

## 12.11 — PHASE 2.5 TASK BREAKDOWN

1. **Schema migration** (0.5 day): Add GeneratedVisualization + TemplateVersion models.

2. **Visualization queue** (0.5 day): New `visualization-render` BullMQ queue, worker entry point, producer hook on Gap Score save.

3. **Browser renderer infrastructure** (1 day): Playwright setup, React → PNG pipeline, caching layer, error handling.

4. **Brand template foundations** (0.5 day): Shared components (brand footer, source citation, color tokens, typography, gauge component).

5. **First three ground truth templates** (1 day): SEC Form 4, CFTC COT, Price Move Anomaly. These three cover ~60% of expected fires in early data.

6. **Gap Score aggregate templates** (0.5 day): Three-stream decomposition, Gap Score trend, hot list snapshot.

7. **Remaining ground truth templates** (1-1.5 days): Maritime AIS (with Mapbox), Inventory release, Macro surprise, Congressional trade, 13D/G.

8. **Satellite diff template** (0.5-1 day): More complex; Sentinel Hub integration for imagery retrieval, change detection overlay.

9. **Narrative + psychological templates** (0.5 day): Article volume, cashtag velocity, cross-platform trend.

10. **Storage integration** (0.5 day): Supabase Storage client, bucket setup, URL generation, signed URLs for gated content.

11. **Admin template preview** (0.5 day): `/admin/templates` route showing example renders for each template, with regenerate button.

12. **Dashboard Evidence tab** (1 day): Render visualizations on asset detail pages, handle permissions (public vs. gated variants).

13. **Social content integration** (1 day): Wire visualizations into the draft tweet queue, image-first post drafting prompt, alt text generation.

14. **Testing** (1 day): Template-render tests, cache behavior tests, storage integration tests, image diff tests for regression detection.

**Total: ~10-12 days** at Conner's pace (14h/day).

Can be compressed further by parallelizing template work — multiple templates can be built simultaneously since they don't interact.

---

## 12.12 — TESTING REQUIREMENTS

1. **Template-render tests** (per template): Given fixture data, renders produce expected output (image diff tolerance ~5%).

2. **Brand-consistency test**: Every rendered image contains the Overcurrent wordmark at expected position. Every image has a source citation. Every image uses brand colors.

3. **Cache behavior test**: Identical data payload hash returns cached URL instead of re-rendering.

4. **Dimension variant test**: Same template at different dimensions produces same visual content, scaled appropriately.

5. **Source attribution test**: Every template includes the correct attribution string for its data source.

6. **Alt text generation test**: Haiku produces alt text within character limit, contains asset ticker.

7. **Storage integration test**: Rendered image persists to Supabase Storage and returns expected URL.

8. **Queue integration test**: Gap Score save above threshold enqueues a render job with correct payload.

9. **Permission test**: Public URLs are accessible without auth; signed URLs require valid session.

10. **Compliance test**: No visualization output contains full-text article reproductions or paywalled content snippets.

Target: 30-40 additional tests, keeping the suite above 600 passing by Phase 2.5 completion.

---

## 12.13 — OPEN QUESTIONS / FLAGS

1. **Satellite imagery interpretation.** Path B (relative change detection) gives you "this changed" but not "inventory is at 73%." For v1, label satellite visualizations as "change detection, directional only" — don't claim absolute measurements. Year 2 quant hire unlocks Path A.

2. **Font licensing at render time.** Playfair Display and IBM Plex Sans are open source (SIL Open Font License). IBM Plex Mono same. Safe for commercial use. Bundle into render worker so no CDN dependency.

3. **Privacy of social posts in visualizations.** When rendering psychological stream visualizations that show specific posts (engagement acceleration, cross-platform trends), redact usernames on public outputs. Paid dashboard variants can show usernames (fair use for analysis, not for mass republication).

4. **Legal review of Congressional trade cards.** Public records, but faces and identifying info need handling — standard practice is to show member name, committee memberships, trade details. Don't add commentary that could be interpreted as defamatory. Pre-launch legal review (same $500 budget line as paper trading disclaimers).

5. **Video/GIF rendering bottleneck.** Time-lapse GIFs (maritime AIS over 72h) are 10-30x the render cost of static PNGs. Gate to high-severity anomalies only (severity > 0.8). Don't generate for every Gap Score fire.

6. **Mapbox pricing tier.** Static API free tier is 50K requests/month — way above v1 volume. Upgrade trigger when you hit 40K/month (roughly 1000+ maritime visualizations/day). Fine for v1.

---

## 12.14 — WHY THIS CHANGES THE PRODUCT STORY

The visualization pipeline is not "marketing assets." It's the **product's core differentiator.**

Every competitor sits one layer up from the data:
- Permutable: "Here's our sentiment score"
- Unusual Whales: "Here's unusual options activity"
- Whale Alert: "Here's a blockchain transaction"
- SpotGamma: "Here's our gamma curve"

Overcurrent posts the data itself:
- "Here's the Form 4 filing. Here's the CFTC release. Here's the satellite imagery. Here's the AIS screenshot. Draw your own conclusion. But by the way — we quantify when these signals disagree with the market price. That's our Gap Score."

The raw data is more credible, more shareable, and more defensible than any interpretation. It reframes Overcurrent from "another financial analytics tool" to "the people who show you what's actually happening."

Pricing implication: $249-499 Enterprise-lite tier becomes defensible at Month 3-4 once the visualization pipeline is producing high-quality output. Gate high-res variants, API access to raw visualization URLs, and CSV export of underlying data to that tier.

---

## 12.15 — FINAL NOTES FOR CLAUDE CODE

- **Start with three templates.** SEC Form 4, CFTC COT, Price Move. These are mechanically simple and will cover ~60% of initial fires. Don't try to ship all 18 templates at once.

- **Render quality is load-bearing.** A poorly-rendered chart is worse than no chart. Iterate on the three foundational templates until they look professional, then expand.

- **Test with real Phase 2 output.** Don't build templates on synthetic data alone. Wait until Gap Score is producing real fires and use those as template input.

- **Admin preview UI is mandatory.** Before shipping any template publicly, generate 10-20 example renders and review them manually. Most template issues only show up when real data hits edge cases.

- **Template versioning is not optional.** When a template changes visually, bump the version. Historical Gap Scores keep their original rendered images. New Gap Scores get the new template.

- **Minimalism is the brand.** Every time you feel tempted to add another annotation, callout, or color, remove one instead. The data is the hero. Ask before adding visual complexity.

- **No A/B testing in v1.** Ship one template version per type. Iterate on feedback. A/B testing comes later when template change velocity increases and we need statistical signal on which performs better.
