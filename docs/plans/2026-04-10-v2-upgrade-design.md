# Overcurrent v2 Upgrade Design

## Priority Order (User-Defined)

1. Fix GDELT rate limiting + RSS as primary fallback
2. Expand outlet registry to 200+ outlets
3. Anti-hallucination rules in all agent prompts
4. Admin portal (review/publish workflow with Supabase Auth)
5. Multi-model support (OpenAI + Google alongside Anthropic)
6. Social draft generation agent
7. Disclaimer + error flag components
8. Custom scrapers to reduce GDELT dependency

## Infrastructure: Keep Current
- Supabase (PostgreSQL) — already working
- Vercel deployment — already working
- Migrate to self-hosted Postgres + Redis later when needed

## Phase 1: Fix GDELT + RSS Primary

**Problem:** GDELT returns 0 results on Vercel (rate-limited or IP-blocked). All sources currently come from RSS.

**Fix:**
- Make RSS the primary source layer (it works reliably)
- GDELT becomes supplementary — try it, use results if available, don't depend on it
- Add 5.5s delays between GDELT queries
- Auto-quote hyphenated words for GDELT

**Already partially done** in current codebase.

## Phase 2: Expand Outlet Registry to 200+

**Current:** 108 outlets
**Target:** 200+ outlets across all 6 regions with proper metadata

**Changes:**
- Expand `src/data/outlets.ts` to 200+ entries
- Add more RSS feeds for international outlets
- Ensure every region has 20+ outlets minimum
- Add `language` field to OutletInfo
- Focus on: Middle East (Al Jazeera Arabic, PressTV, IRNA), Asia (Asahi, Mainichi, Yomiuri), Latin America (Clarín, Infobae, G1), Africa (Punch Nigeria, Daily Maverick, Premium Times)

## Phase 3: Anti-Hallucination Rules

**Add to EVERY agent prompt:**
```
ANTI-HALLUCINATION RULES — MANDATORY:
1. Every claim must reference a specific outlet by name.
2. Do not infer from titles alone. If no full text, state "based on title only" and cap confidence at MEDIUM.
3. Never say an outlet "did not report." Say "not found in available coverage."
4. If 30 outlets cite the same wire source, that's 1 source repeated, not 30 confirmations.
5. Consensus >90%: note "near-universal consensus may reflect shared assumptions."
6. "We don't know" and "insufficient evidence" are valid conclusions.
7. Only use sources provided. Do not use training data.
8. Review every claim: "Can I name the outlet? Could I be inferring?" If yes to second, remove or downgrade.
```

**Also update:**
- Confidence levels: HIGH → MEDIUM → LOW → DEVELOPING (not verified/unverified)
- Language: "widely corroborated" not "verified", "not found in available coverage" not "did not report"
- Source provenance: track wire copies (AP/Reuters/AFP) vs. independent reporting

## Phase 4: Admin Portal

**Schema changes:**
- Add `status` field to Story: draft | review | published | archived
- Add `status` field to UndercurrentReport: draft | review | published | archived
- Add `publishedAt` field to both
- Add `SocialDraft` model
- Add `ErrorFlag` model
- Add `StorySuggestion` model

**Auth:** Supabase Auth (email/password)

**Pages:**
- `/admin` — dashboard: stories in review, pending drafts, error flags, costs
- `/admin/stories/[id]` — edit/review/publish a story
- `/admin/social` — manage social drafts
- `/admin/analyze` — trigger new analysis (form → async pipeline)
- `/admin/costs` — detailed cost breakdown

**Public changes:**
- Home page only shows `status: "published"` stories
- Analysis runs → saves at `status: "review"` → admin publishes

## Phase 5: Multi-Model Support

**New file:** `src/lib/models.ts`
- Unified wrapper: `callModel({ provider, tier, system, userMessage, ... })`
- Providers: anthropic (Claude), openai (GPT-4o), google (Gemini)
- Tiers: fast (Haiku/4o-mini/Flash), deep (Sonnet/4o/Pro)
- Graceful degradation: if OpenAI/Google keys missing, use Claude for all

**Regional analysis changes:**
- Each region analyzed by 2 different models (rotation table)
- Reconciliation agent (Haiku) compares outputs
- Agreements → HIGH confidence, disagreements → flagged, hallucinations → removed

**New agent:** `src/agents/reconciliation.ts`

## Phase 6: Social Draft Generation

**New agent:** `src/agents/social-drafts.ts`
- Input: completed analysis
- Output: Twitter (2 options), LinkedIn, Reddit, Newsletter snippet
- All drafts saved to SocialDraft model at status "draft"
- Admin reviews/edits/approves before posting

## Phase 7: Disclaimer + Error Flags

**Components:**
- `Disclaimer.tsx` — banner on every analysis page
- `ErrorFlagButton.tsx` — "We could be wrong — help us be right" + flag form
- `ShareButtons.tsx` — Twitter, LinkedIn, Reddit, email, copy link

**API:**
- `POST /api/errors` — submit error flag
- `POST /api/suggest` — submit story suggestion

## Phase 8: Custom Scrapers

**Framework:** `src/ingestion/scrapers/framework.ts`
- Configurable per outlet (RSS, HTML, API methods)
- Rate limiting, retries, failure handling
- Archives everything to ArchivedArticle
- Start with RSS scrapers, add Playwright HTML scrapers later

---

## Language/Philosophy Changes Throughout

Replace across all prompts and UI:
- "verified" → "high confidence" or "widely corroborated"
- "unbiased" → "transparent"
- "outlet did not report" → "not found in available coverage"
- "true/false" → "high/low confidence"
- Add disclaimer to every analysis page
