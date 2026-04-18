# Post-Predictive-Layer Roadmap — Queued Work

**Status:** Queued. Do NOT start until Sessions 3 + 4 of the predictive signal infrastructure are complete (admin UIs + backfill + public isolation CI test).

**Priority order:** Features first (consumer-facing), then datasets (pipeline expansion). Case study library starts immediately — runs in parallel with everything else.

---

## Three features to build

### Feature 1 — Story Subscription Alerts (consumer retention)

**Why:** Converts founding-rate subscribers into permanent subscribers. Reduces churn. Generates behavioral data on which story categories drive subscriber engagement.

**Mechanism:** Paid subscribers can "follow" a specific `StoryCluster`. When a new `Story` is assigned to that cluster (via Session 2 clustering logic), the follower gets notified.

**DB changes needed:**
- `ClusterSubscription` table: `{ id, userId (Supabase user email), storyClusterId, createdAt, lastNotifiedAt }`
- `@@unique([userId, storyClusterId])`

**Notification channels:**
- Email (Resend — already in stack)
- Optional: in-app notification badge

**Trigger hook:** Fires from `runSignalTracking` at the end of the pipeline, AFTER cluster assignment. Checks `ClusterSubscription` rows where `storyClusterId = match.clusterId` AND `isNewCluster = false` (only notify on new analyses in EXISTING clusters, not on first-time cluster creation).

**Rate limit:** Max 1 notification per subscriber per cluster per 24h (use `lastNotifiedAt`).

**UI:** Subscribe/unsubscribe button on public story pages ("Follow this story"). Requires auth.

---

### Feature 2 — Analyst Dashboard ($49-99/mo tier)

**Why:** Bridges consumer → enterprise without a sales motion. Subscribers self-select into enterprise by usage. Power users (journalists, academics, analysts) get read-only access to the outlet fingerprint database.

**Tier gating:**
- Current: free (paywall at 6) + basic subscribed ($4.99/mo — the current tier)
- New: Pro ($49/mo) — analyst dashboard + higher paywall + longer archive access
- New: Team ($99/mo) — Pro + API access

**What the dashboard shows:**
- Outlet fingerprint query: "Which outlets covered {story}?" → list with framing, tier, reliability
- Historical comparison: "How does {outlet}'s framing on this story compare to their baseline for this signalCategory?"
- Regional omission diff: "Which facts were present in regional coverage but absent from wire coverage on this story?"
- Outlet behavioral card: deep-dive view for any outlet showing their fingerprint (primaryFramingDistribution, sourceTypePreference, omissionRate, pickupSpeed)

**Implementation:**
- New routes under `/analyst/*` (auth-gated by Supabase + tier check)
- Read-only queries against `Outlet`, `OutletFingerprint`, `OutletAppearance`, `FactOmission`, `PredictiveSignal`
- Reuses most admin UI components but with a cleaner, narrower surface
- Never exposes: PredictiveSignal that has category disabled, internal-only findings, story clusters still in "review" status

**Stripe:**
- Add Pro + Team price IDs
- Tier stored in `user_metadata.tier` alongside existing `subscribed` flag

---

### Feature 3 — Public Accuracy Tracker

**Why:** Credibility compounding engine. Documented correct calls make every future enterprise conversation shorter. High-performing social content format.

**Mechanism:** When Overcurrent's analysis flags an omission or framing divergence that subsequently becomes the dominant narrative, log it publicly with timestamps.

**Detection:**
- Manual-first: admin marks a historical `FactOmission` or `FramingTag` as "surfaced" when a later analysis corroborates it
- Automated candidate detection: when a `FactOmission` from an earlier cluster analysis appears as a `carriedByOutlets` entry in a NEW cluster analysis with >50% source presence, flag it as a candidate for accuracy-tracker entry

**DB:**
- `AccuracyTrackerEntry` table: `{ id, storyClusterId, originalFindingId, originalFindingType (factOmission | framingDivergence), originalFlaggedAt, surfacedInMainstreamAt, mainstreamOutlets (JSON), headline, summary, socialDraft (JSON — Twitter/LinkedIn ready), status (draft | published | archived), publishedAt }`

**UI:**
- Public page `/accuracy` — chronological list of verified predictions
- Each entry: "Flagged {originalFlaggedAt}, surfaced in mainstream {surfacedInMainstreamAt}, Δ {hours}h"
- Social draft auto-generated for each entry, awaiting admin approval

**Legal-defense value:** archive of consistent methodology applied uniformly across hundreds of cases.

---

## Three datasets to acquire

### Dataset 1 — GDELT (already integrated, deepen it)

**Status:** Currently integrated as one of three ingestion streams (`searchGdeltGlobal` in `src/ingestion/gdelt.ts`). Best-effort 15s timeout.

**Expansion actions:**
- Increase volume/concurrency in `searchGdeltGlobal` (currently capped low to prevent timeout)
- Add GDELT Events 2.0 integration (event-based, not article-based) for cross-referencing against narrative coverage
- Add GDELT GKG (Global Knowledge Graph) integration for entity + tone analysis
- Use GDELT's multilingual coverage to expand into languages Overcurrent doesn't yet scrape directly (Mandarin, Hindi, Arabic source discovery)

**Positioning:** GDELT is the coverage breadth layer. Curated outlets (`src/data/outlets.ts`) remain the quality signal layer. Fingerprinted outlets never get replaced by GDELT sources.

**Cost:** $0. Free API.

---

### Dataset 2 — Government Spending Data

**Sources to integrate in order:**
1. **USASpending.gov** — US federal contracts + grants. Free API. Priority #1.
2. **FPDS** (Federal Procurement Data System) — US federal procurement. Free.
3. **EU Tenders Electronic Daily (TED)** — EU public procurement. Free.
4. **UK Companies House** — UK corporate registry. Free API.
5. **India: eProcurement portals** (state-level, fragmented). Lower priority.
6. **Brazil: Portal da Transparência**. Free, moderate quality.
7. **South Africa: eTenders**. Free but inconsistent.

**Integration architecture:**
- New module: `src/ingestion/government-spending.ts`
- New DB table: `GovernmentSpendingEvent { id, country, agency, amount, currency, recipientEntity, contractDate, source, rawPayload (JSON), retrievedAt, linkedStoryIds (JSON of storyIds where this event surfaced) }`
- Cross-reference trigger: during signal tracking, check if any FactOmission.factType = 'financial_detail' has matching keywords in GovernmentSpendingEvent; if so, link them
- New FactOmission subtype: `documented_financial` — flagged when coverage omits a detail that exists in government spending data

**Signal value:** When a $400M defense contract is awarded and coverage frames it purely as a jobs story while the spending data shows it went to a company with specific lobbying relationships — that's the kind of finding a policy shop or journalist pays for.

**Cost:** $0 (public data).

---

### Dataset 3 — Maritime AIS Data

**Source:** MarineTraffic free tier (rate-limited) initially. Upgrade to paid tier when enterprise traction justifies it.

**Integration:**
- New module: `src/ingestion/maritime-ais.ts`
- New DB table: `MaritimeEvent { id, vesselImo, vesselName, eventType (course_change | port_call | speed_anomaly | ais_gap), location (lat/lng), timestamp, rawPayload, linkedStoryIds }`
- Not trying to track every vessel — targeting major maritime events that cross-reference against narrative coverage
- Triggers: cluster analysis that mentions specific vessels, ports, or straits checks MaritimeEvent rows in the relevant time window

**Signal value:** "Three vessels changed course in the strait 18 hours before coverage emerged" — concrete raw-data evidence that no media intelligence competitor can replicate.

**Cost:** $0 at start (free tier). Upgrade path to ~$200-500/mo paid tier when enterprise motion justifies it.

---

## Standing discipline: Internal Case Study Library

**Start immediately.** Runs in parallel with everything else. No new code required.

**Process:** After every analysis that produces a surprising finding, spend 10 minutes writing a structured case study.

**Template:** `docs/case-studies/YYYY-MM-DD-{slug}.md`

```markdown
# {Date}: {Story}

## Mainstream narrative
What mainstream coverage said at the time.

## What Overcurrent found
The buried finding, framing divergence, or omission Overcurrent flagged.

## Evidence
- Which outlets carried the finding (with URLs)
- Which outlets buried it (with URLs)
- Source type (regional, specialty, emerging)
- Cluster + phase context

## Subsequent surfacing
If mainstream coverage later picked up the finding: when, which outlets,
how many hours after Overcurrent flagged it.

## Why this matters
1-2 sentences: what this demonstrates about the system's capability.

## Related data
Links to the analysis URL, relevant fingerprints, category patterns.
```

**Three downstream uses (none require extra work beyond the case study itself):**

1. **Enterprise sales deck:** At month 10, 200 documented cases become a pitch deck without having built one.
2. **Accuracy tracker content:** Stripped-of-sensitive-context versions become the public `/accuracy` entries. Social format: "Six weeks ago we flagged this. Here's what happened next."
3. **Legal / methodological defense:** Archive of consistent methodology applied uniformly across hundreds of cases.

**Cost:** 10 min per surprising analysis. Zero marginal work that isn't already valuable.

---

## Acceleration principle

The current test analyses aren't just debugging. Treat every one like it could close your first enterprise deal. Run to that standard. Document to that discipline. The gap between where Overcurrent is right now and where this goes is closed by relentless daily execution at a standard that never drops even when nobody is watching.

---

## Execution order when this plan activates

**Prerequisite:** Sessions 3 (admin UIs) + 4 (backfill + CI isolation test) of predictive signal infrastructure must be complete.

**Then:**

1. **Immediate:** Start case study library on whatever analyses have already run. Backfill ~12 stories worth of case studies if findings warrant.
2. **Feature 3 (Accuracy Tracker):** Ship first — requires only admin UI + public read-only page. Smallest surface area, highest credibility ROI.
3. **Dataset 1 (GDELT expansion):** Low-risk, zero-cost. Deepen the already-integrated pipeline.
4. **Feature 1 (Subscription Alerts):** Consumer retention lift.
5. **Dataset 2 (Government Spending):** Biggest signal value of the three datasets.
6. **Feature 2 (Analyst Dashboard):** Largest surface area. Requires Stripe tier work + new auth gating.
7. **Dataset 3 (Maritime AIS):** Last — highest signal specificity but narrowest initial scope.
