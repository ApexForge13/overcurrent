# AI Debate Architecture + Social Media Automation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-model regional analysis with a 3-round, 4-model AI debate system (Claude, GPT-4o, Gemini, Grok), then auto-generate platform-specific social media drafts after every analysis.

**Architecture:** Round 1 (4 models analyze independently) → Round 2 (each model cross-examines other 3) → Round 3 (Claude moderates final output). Per region, per story. Social drafts auto-generated at pipeline end, managed via admin panel.

**Tech Stack:** Anthropic SDK, OpenAI SDK (for GPT-4o + Grok via x.ai), Google Generative AI SDK, Prisma (Supabase PostgreSQL), Next.js 16

---

## Task 1: Install OpenAI + Google AI SDKs, Add xAI Provider

**Files:**
- Modify: `package.json`
- Create: `src/lib/models.ts`

**Step 1: Install dependencies**

```bash
cd F:/Overcurrent/overcurrent
npm install openai @google/generative-ai
```

**Step 2: Create `src/lib/models.ts` — Unified multi-model wrapper**

This wraps all 4 AI providers behind one `callModel()` function. Every AI call in the debate system goes through here.

```typescript
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '@/lib/db'

// Provider clients (lazy-initialized)
let anthropicClient: Anthropic | null = null
let openaiClient: OpenAI | null = null
let xaiClient: OpenAI | null = null
let googleClient: GoogleGenerativeAI | null = null

function getAnthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic()
  return anthropicClient
}

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')
    openaiClient = new OpenAI()
  }
  return openaiClient
}

function getXAI(): OpenAI {
  if (!xaiClient) {
    if (!process.env.XAI_API_KEY) throw new Error('XAI_API_KEY not set')
    xaiClient = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    })
  }
  return xaiClient
}

function getGoogle(): GoogleGenerativeAI {
  if (!googleClient) {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY not set')
    googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
  }
  return googleClient
}

// Model mapping
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'xai'
export type ModelTier = 'fast' | 'deep'

const MODEL_MAP: Record<ModelProvider, Record<ModelTier, string>> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', deep: 'claude-sonnet-4-20250514' },
  openai:    { fast: 'gpt-4o-mini', deep: 'gpt-4o' },
  google:    { fast: 'gemini-2.0-flash', deep: 'gemini-2.5-pro' },
  xai:       { fast: 'grok-3-mini', deep: 'grok-3' },
}

// Pricing per million tokens (input / output)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  'claude-sonnet-4-20250514':  { input: 3.0, output: 15.0 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60 },
  'gpt-4o':                    { input: 2.50, output: 10.0 },
  'gemini-2.0-flash':          { input: 0.10, output: 0.40 },
  'gemini-2.5-pro':            { input: 1.25, output: 10.0 },
  'grok-3-mini':               { input: 0.30, output: 0.50 },
  'grok-3':                    { input: 3.0, output: 15.0 },
}

export interface ModelCallOptions {
  provider: ModelProvider
  tier: ModelTier
  system: string
  userMessage: string
  maxTokens?: number
  agentType: string
  region?: string
  storyId?: string
  undercurrentReportId?: string
}

export interface ModelCallResult {
  text: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  provider: string
  model: string
}

// Daily cost cap check (across ALL providers)
async function checkCostCap(): Promise<void> {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  const result = await prisma.costLog.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: start, lte: end } },
  })
  const dailyCost = result._sum.costUsd ?? 0
  const cap = parseFloat(process.env.DAILY_COST_CAP ?? '5')
  if (dailyCost >= cap) {
    throw new Error(`Daily cost cap reached ($${dailyCost.toFixed(4)} / $${cap}). Refusing API calls.`)
  }
}

export async function callModel(options: ModelCallOptions): Promise<ModelCallResult> {
  await checkCostCap()

  const model = MODEL_MAP[options.provider][options.tier]
  const maxTokens = options.maxTokens ?? 4096

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  if (options.provider === 'anthropic') {
    const client = getAnthropic()
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: options.system,
      messages: [{ role: 'user', content: options.userMessage }],
    })
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    inputTokens = response.usage.input_tokens
    outputTokens = response.usage.output_tokens

  } else if (options.provider === 'openai' || options.provider === 'xai') {
    const client = options.provider === 'xai' ? getXAI() : getOpenAI()
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.userMessage },
      ],
    })
    text = response.choices[0]?.message?.content ?? ''
    inputTokens = response.usage?.prompt_tokens ?? 0
    outputTokens = response.usage?.completion_tokens ?? 0

  } else if (options.provider === 'google') {
    const client = getGoogle()
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: options.system,
    })
    const response = await genModel.generateContent(options.userMessage)
    text = response.response.text()
    inputTokens = response.response.usageMetadata?.promptTokenCount ?? 0
    outputTokens = response.response.usageMetadata?.candidatesTokenCount ?? 0
  }

  // Calculate cost
  const pricing = PRICING[model] ?? { input: 0, output: 0 }
  const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000

  // Log to DB
  await prisma.costLog.create({
    data: {
      model,
      agentType: options.agentType,
      inputTokens,
      outputTokens,
      costUsd,
      region: options.region ?? null,
      storyId: options.storyId ?? null,
      undercurrentReportId: options.undercurrentReportId ?? null,
    },
  })

  return { text, inputTokens, outputTokens, costUsd, provider: options.provider, model }
}

// Check which providers are available
export function getAvailableProviders(): ModelProvider[] {
  const providers: ModelProvider[] = ['anthropic'] // always available
  if (process.env.OPENAI_API_KEY) providers.push('openai')
  if (process.env.GOOGLE_AI_API_KEY) providers.push('google')
  if (process.env.XAI_API_KEY) providers.push('xai')
  return providers
}

// Re-export parseJSON from anthropic.ts for convenience
export { parseJSON } from '@/lib/anthropic'
```

**Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/models.ts
git commit -m "feat: add multi-model wrapper with OpenAI, Google AI, and xAI providers"
```

---

## Task 2: Add Debate Config + DebateRound Schema

**Files:**
- Create: `src/lib/debate-config.ts`
- Modify: `prisma/schema.prisma`

**Step 1: Create `src/lib/debate-config.ts`**

```typescript
import type { ModelProvider } from '@/lib/models'

export interface DebateModel {
  id: string
  provider: ModelProvider
  model: string
  name: string // display name
}

export const DEBATE_MODELS: Record<string, DebateModel> = {
  analyst_1: { id: 'analyst_1', provider: 'anthropic', model: 'claude-sonnet-4-20250514', name: 'Claude' },
  analyst_2: { id: 'analyst_2', provider: 'openai', model: 'gpt-4o', name: 'GPT-4o' },
  analyst_3: { id: 'analyst_3', provider: 'google', model: 'gemini-2.5-pro', name: 'Gemini' },
  analyst_4: { id: 'analyst_4', provider: 'xai', model: 'grok-3', name: 'Grok' },
}

export const MODERATOR: DebateModel = {
  id: 'moderator',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  name: 'Claude (Moderator)',
}

export const ALL_ANALYST_IDS = ['analyst_1', 'analyst_2', 'analyst_3', 'analyst_4'] as const

// Get only analysts whose API keys are configured
export function getAvailableAnalysts(): DebateModel[] {
  const analysts: DebateModel[] = [DEBATE_MODELS.analyst_1] // Claude always available
  if (process.env.OPENAI_API_KEY) analysts.push(DEBATE_MODELS.analyst_2)
  if (process.env.GOOGLE_AI_API_KEY) analysts.push(DEBATE_MODELS.analyst_3)
  if (process.env.XAI_API_KEY) analysts.push(DEBATE_MODELS.analyst_4)
  return analysts
}
```

**Step 2: Add DebateRound + SocialDraft to Prisma schema**

Add after the FollowUpQuestion model in `prisma/schema.prisma`:

```prisma
model DebateRound {
  id           String   @id @default(cuid())
  storyId      String
  story        Story    @relation(fields: [storyId], references: [id], onDelete: Cascade)
  region       String
  round        Int      // 1, 2, or 3
  modelName    String   // "Claude" | "GPT-4o" | "Gemini" | "Grok" | "Claude (Moderator)"
  provider     String   // anthropic | openai | google | xai
  content      String   // full JSON response
  inputTokens  Int
  outputTokens Int
  costUsd      Float
  createdAt    DateTime @default(now())
}

model SocialDraft {
  id                   String   @id @default(cuid())
  storyId              String?
  story                Story?   @relation(fields: [storyId], references: [id], onDelete: SetNull)
  undercurrentReportId String?
  undercurrentReport   UndercurrentReport? @relation("UndercurrentSocialDrafts", fields: [undercurrentReportId], references: [id], onDelete: SetNull)
  platform             String   // twitter_hook | twitter_thread | reddit | linkedin | tiktok | newsletter
  content              String   // AI-generated content
  metadata             String?  // JSON: subreddits, thread tweet count, etc.
  editedContent        String?  // admin's edited version (original preserved)
  status               String   @default("draft") // draft | approved | scheduled | posted | rejected
  scheduledFor         DateTime?
  postedAt             DateTime?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

Add relations to Story model:
```prisma
// In Story model, add:
  debateRounds    DebateRound[]
  socialDrafts    SocialDraft[]
```

Add relation to UndercurrentReport model:
```prisma
// In UndercurrentReport model, add:
  socialDrafts    SocialDraft[] @relation("UndercurrentSocialDrafts")
```

**Step 3: Push schema to Supabase**

Since we can't run prisma migrate from local (IPv6 issue), generate the SQL:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migration-debate.sql
```

Then provide the SQL for the user to run in Supabase SQL editor. (Only the NEW tables — DebateRound and SocialDraft.)

**Step 4: Generate Prisma client**

```bash
npx prisma generate
```

**Step 5: Commit**

```bash
git add src/lib/debate-config.ts prisma/schema.prisma prisma/migration-debate.sql
git commit -m "feat: add debate config and DebateRound + SocialDraft schema"
```

---

## Task 3: Create Round 1 — Independent Analysis Agent

**Files:**
- Create: `src/agents/debate-round1.ts`

**Step 1: Create the agent**

The agent takes a region's sources and produces an independent analysis. The system prompt is identical for all 4 models — only the model changes.

Key exports:
- `Round1Analysis` interface (matching the JSON schema in the spec)
- `runRound1(model: DebateModel, region: string, sources: SourceInput[], query: string, storyId?: string): Promise<Round1Result>`

The `Round1Result` includes the parsed analysis PLUS raw text, tokens, and cost.

System prompt: Use the EXACT prompt from the spec (independent analyst, anti-hallucination rules, JSON response shape with key_facts, contested_claims, dominant_framing, political_lean_split, etc.)

Import `ANTI_HALLUCINATION_RULES` from `./prompts` and embed in the system prompt.

Use `callModel()` from `src/lib/models.ts` with `provider: model.provider`, `tier: 'deep'`, `agentType: 'debate_r1'`.

**Step 2: Commit**

```bash
git add src/agents/debate-round1.ts
git commit -m "feat: add Round 1 independent analysis debate agent"
```

---

## Task 4: Create Round 2 — Cross-Examination Agent

**Files:**
- Create: `src/agents/debate-round2.ts`

**Step 1: Create the agent**

Each model receives its own R1 + other 3 R1s + original sources. Produces confirmations, challenges, corrections, additions, concessions, provenance flags.

Key exports:
- `Round2Analysis` interface (confirmations, challenges, corrections, additions, concessions, provenance_flags)
- `runRound2(model: DebateModel, region: string, ownR1: Round1Analysis, otherR1s: Array<{modelName: string, analysis: Round1Analysis}>, sources: SourceInput[], query: string, storyId?: string): Promise<Round2Result>`

System prompt: Use the EXACT prompt from the spec. Explicitly adversarial — "this is a professional debate, not a polite agreement session."

Use `callModel()` with `tier: 'deep'`, `agentType: 'debate_r2'`, `maxTokens: 8192` (cross-exam responses are longer since they reference other analyses).

**Step 2: Commit**

```bash
git add src/agents/debate-round2.ts
git commit -m "feat: add Round 2 cross-examination debate agent"
```

---

## Task 5: Create Round 3 — Moderator Synthesis Agent

**Files:**
- Create: `src/agents/debate-moderator.ts`

**Step 1: Create the agent**

The moderator receives ALL R1 + ALL R2 + original sources. Produces final regional analysis with consensus findings, resolved disputes, unresolved disputes, caught errors, unique insights.

Key exports:
- `ModeratorOutput` interface (consensus_findings, resolved_disputes, unresolved_disputes, caught_errors, unique_insights, dominant_framing, source_quality, omissions, debate_quality_note)
- `runModerator(region: string, r1Results: Array<{modelName: string, analysis: Round1Analysis}>, r2Results: Array<{modelName: string, analysis: Round2Analysis}>, sources: SourceInput[], query: string, storyId?: string): Promise<ModeratorResult>`

System prompt: Use the EXACT prompt from the spec. Impartial moderator. Evidence quality decides disputes.

Use `callModel()` with `provider: 'anthropic'` (Claude Sonnet as moderator), `tier: 'deep'`, `agentType: 'debate_moderator'`, `maxTokens: 8192`.

**Step 2: Commit**

```bash
git add src/agents/debate-moderator.ts
git commit -m "feat: add Round 3 moderator synthesis debate agent"
```

---

## Task 6: Create Debate Orchestrator

**Files:**
- Create: `src/lib/debate.ts`

**Step 1: Create the orchestrator**

This coordinates the 3-round debate for a single region. The pipeline calls this instead of `analyzeRegion()`.

```typescript
export async function runRegionalDebate(
  region: string,
  sources: SourceInput[],
  query: string,
  storyId?: string,
  onProgress?: (msg: string) => void,
): Promise<{
  moderatorOutput: ModeratorOutput
  debateRounds: DebateRoundData[]  // for storing in DB
  totalCost: number
}>
```

Flow:
1. Get available analysts via `getAvailableAnalysts()`
2. **Round 1:** Run all available analysts in parallel via `Promise.all`
3. **Round 2:** Run all available analysts in parallel, each receiving own R1 + others' R1s
4. **Round 3:** Run moderator with all R1 + R2 results
5. Collect all `DebateRoundData` objects for DB storage
6. Return moderator output + debate history + total cost

If only 1 model available (Claude-only fallback), skip R2 and R3 — just use R1 as the regional analysis directly.

If 2-3 models available, run debate with whatever's available.

**Step 2: Create adapter to convert ModeratorOutput → RegionalAnalysis**

The synthesis agent expects `RegionalAnalysis` format. Create a converter:

```typescript
export function moderatorToRegionalAnalysis(
  mod: ModeratorOutput,
  region: string,
  totalCost: number,
): RegionalAnalysis
```

Maps:
- `consensus_findings` → `claims` (HIGH confidence)
- `resolved_disputes` → `claims` (with final_confidence from moderator)
- `unresolved_disputes` → `discrepancies`
- `caught_errors` → omitted from claims (they were wrong)
- `unique_insights` → `claims` (MEDIUM confidence)
- `dominant_framing` → `framingAnalysis`
- `omissions` → `omissions`

This way synthesis.ts works unchanged.

**Step 3: Commit**

```bash
git add src/lib/debate.ts
git commit -m "feat: add debate orchestrator with RegionalAnalysis adapter"
```

---

## Task 7: Create Social Draft Agent

**Files:**
- Create: `src/agents/social-drafts.ts`

**Step 1: Create the agent**

Uses Haiku (cheapest) to generate all 6 platform drafts from a completed analysis.

Key exports:
- `SocialDraftOutput` interface
- `generateSocialDrafts(analysisData: object, storyId?: string, undercurrentReportId?: string): Promise<DraftOutput[]>`

System prompt: Use the EXACT prompt from the spec. Voice: direct, counter-culture, data-driven. Generates twitter_hooks (2), twitter_thread, reddit, linkedin, tiktok_script, newsletter.

Use `callModel()` with `provider: 'anthropic'`, `tier: 'fast'` (Haiku), `agentType: 'social_draft'`, `maxTokens: 4096`.

Parse response and return array of `{ platform, content, metadata }` objects.

**Step 2: Commit**

```bash
git add src/agents/social-drafts.ts
git commit -m "feat: add social draft generation agent"
```

---

## Task 8: Update Pipeline with Debate + Social Drafts

**Files:**
- Modify: `src/lib/pipeline.ts`

**Step 1: Replace regional analysis with debate**

In `pipeline.ts`, replace the import of `analyzeRegion` with debate imports:

```typescript
import { runRegionalDebate, moderatorToRegionalAnalysis } from '@/lib/debate'
import { generateSocialDrafts } from '@/agents/social-drafts'
```

Replace the regional analysis section (lines 216-248) with:

```typescript
// Run debates for regions with sources (all regions in parallel, rounds in sequence)
const debateResults = await Promise.all(
  regionsWithSources.map(async (region) => {
    const sources = sourcesByRegion.get(region)!
    const result = await runRegionalDebate(region, sources, query, undefined, (msg) => {
      onProgress('analysis', { phase: 'analysis', message: msg, region })
    })
    totalCost += result.totalCost
    return { region, ...result }
  }),
)

// Convert moderator outputs to RegionalAnalysis format for synthesis
const regionalAnalyses = debateResults.map((d) =>
  moderatorToRegionalAnalysis(d.moderatorOutput, d.region, d.totalCost)
)

// Collect all debate rounds for DB storage
const allDebateRounds = debateResults.flatMap((d) => d.debateRounds)
```

**Step 2: Save debate rounds to DB**

In the Prisma transaction (save phase), add after sources:

```typescript
// Debate rounds
if (allDebateRounds.length > 0) {
  await tx.debateRound.createMany({
    data: allDebateRounds.map((d) => ({
      storyId: story.id,
      region: d.region,
      round: d.round,
      modelName: d.modelName,
      provider: d.provider,
      content: JSON.stringify(d.content),
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      costUsd: d.costUsd,
    })),
  })
}
```

**Step 3: Add social draft generation at pipeline end**

After the story is saved and all relations created, add:

```typescript
// Generate social drafts
try {
  const drafts = await generateSocialDrafts({
    headline: synthesisResult.headline,
    synopsis: synthesisResult.synopsis,
    confidenceLevel: synthesisResult.confidenceLevel,
    consensusScore: synthesisResult.consensusScore,
    sourceCount: triageResult.sources.length,
    countryCount: countries.size,
    regionCount: regions.size,
    claims: synthesisResult.claims,
    discrepancies: synthesisResult.discrepancies,
    omissions: synthesisResult.omissions,
    framings: synthesisResult.framings,
  }, story.id)

  if (drafts.length > 0) {
    await tx.socialDraft.createMany({
      data: drafts.map((d) => ({
        storyId: story.id,
        platform: d.platform,
        content: d.content,
        metadata: d.metadata ? JSON.stringify(d.metadata) : null,
        status: 'draft',
      })),
    })
  }
  onProgress('social', { phase: 'social', message: `Generated ${drafts.length} social drafts` })
} catch (err) {
  // Social draft failure should not fail the pipeline
  console.error('Social draft generation failed:', err)
}
```

**Step 4: Commit**

```bash
git add src/lib/pipeline.ts
git commit -m "feat: integrate debate system + social drafts into verify pipeline"
```

---

## Task 9: Add Social Draft Admin API Routes

**Files:**
- Create: `src/app/api/admin/social-drafts/route.ts`
- Create: `src/app/api/admin/social-drafts/[id]/route.ts`
- Create: `src/app/api/admin/social-drafts/bulk/route.ts`

**Step 1: Create GET /api/admin/social-drafts**

Returns paginated drafts with filters (status, platform, storyId). Groups by story.

**Step 2: Create GET/PUT /api/admin/social-drafts/[id]**

GET returns single draft. PUT updates editedContent, status, scheduledFor.

**Step 3: Create PUT /api/admin/social-drafts/bulk**

Bulk approve, reject, or schedule multiple drafts.

All routes use `await params` pattern (Next.js 16).

**Step 4: Commit**

```bash
git add src/app/api/admin/social-drafts/
git commit -m "feat: add social draft admin API routes"
```

---

## Task 10: Build Social Draft Admin UI Components

**Files:**
- Create: `src/components/admin/SocialDraftCard.tsx`
- Create: `src/components/admin/SocialStoryGroup.tsx`
- Create: `src/components/admin/SocialFilters.tsx`

**Step 1: SocialDraftCard**

Shows platform icon, content (editable inline), character count with red warning over limit, status badge, action buttons (edit/approve/schedule/reject). Checkbox for bulk selection.

Platform limits: twitter_hook=280, twitter_thread=280/tweet, reddit=no limit, linkedin=3000, tiktok=no limit, newsletter=no limit.

**Step 2: SocialStoryGroup**

Groups drafts by story. Collapsible. Shows story headline + confidence badge + draft count by platform.

**Step 3: SocialFilters**

Filter bar: status pills, platform pills, search by content.

**Step 4: Commit**

```bash
git add src/components/admin/
git commit -m "feat: add social draft admin UI components"
```

---

## Task 11: Build Social Draft Admin Page

**Files:**
- Create: `src/app/admin/layout.tsx` (simple admin layout with nav)
- Create: `src/app/admin/social/page.tsx`

**Step 1: Create admin layout**

Simple layout with dark theme, "ADMIN" header, nav links (Dashboard, Social, Costs).

**Step 2: Create `/admin/social` page**

Full social content manager page with SocialFilters at top, SocialStoryGroups below. Fetches from `/api/admin/social-drafts`. Inline editing, approve/reject actions, copy-to-clipboard with `[LINK]` replacement.

**Step 3: Commit**

```bash
git add src/app/admin/
git commit -m "feat: add social draft admin page"
```

---

## Task 12: Build DebateHighlights Component

**Files:**
- Create: `src/components/DebateHighlights.tsx`
- Modify: `src/components/StoryDetail.tsx`

**Step 1: Create DebateHighlights**

Collapsible section showing debate results per region. Subsections:
- Full Agreement (green) — consensus findings
- Resolved Disputes (amber) — moderator resolved
- Unresolved Disputes (red) — both sides presented
- Caught Errors (purple) — models caught each other's mistakes

Shows model names for each finding.

**Step 2: Add to StoryDetail**

Insert `<DebateHighlights>` between Claims and Discrepancies sections. Pass debate round data from story query.

**Step 3: Update story detail page query**

In `src/app/story/[slug]/page.tsx`, add `debateRounds: true` to the Prisma include.

**Step 4: Commit**

```bash
git add src/components/DebateHighlights.tsx src/components/StoryDetail.tsx src/app/story/\[slug\]/page.tsx
git commit -m "feat: add debate highlights component to story detail"
```

---

## Task 13: Update Cost Display

**Files:**
- Modify: `src/app/costs/page.tsx`

**Step 1: Add per-provider cost breakdown**

Group cost logs by provider (anthropic/openai/google/xai) and show totals per provider. Add a breakdown section showing model-level detail.

**Step 2: Commit**

```bash
git add src/app/costs/page.tsx
git commit -m "feat: add per-provider cost breakdown to costs page"
```

---

## Task 14: Schema Migration + Build + Deploy

**Step 1: Generate migration SQL for new tables**

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migration-debate-social.sql
```

Extract only the CREATE TABLE statements for DebateRound and SocialDraft (plus ALTER TABLE for new foreign keys).

**Step 2: User runs SQL in Supabase SQL editor**

Provide the exact SQL for the user to paste.

**Step 3: Generate Prisma client + build**

```bash
npx prisma generate
npm run build
```

**Step 4: Update Vercel env vars**

Add OPENAI_API_KEY, GOOGLE_AI_API_KEY, XAI_API_KEY to Vercel.

**Step 5: Commit + push + deploy**

```bash
git add -A
git commit -m "chore: debate architecture + social automation complete"
git push
vercel --prod --yes
```

**Step 6: Test end-to-end**

Run analysis for "US F-15 shot down Iran rescue operation" and verify:
- 4 models produce independent R1 analyses per region
- Models cross-examine each other in R2
- Moderator synthesizes R3 with consensus/disputes/caught errors
- Social drafts auto-generated (twitter hooks, thread, reddit, linkedin, tiktok, newsletter)
- Debate highlights visible on story detail page
- Social drafts visible in admin panel
- Per-provider cost breakdown shows all 4 providers

---

## Summary

| Task | What | New Files | Modified Files |
|------|------|-----------|---------------|
| 1 | Multi-model wrapper | models.ts | package.json |
| 2 | Debate config + schema | debate-config.ts | schema.prisma |
| 3 | Round 1 agent | debate-round1.ts | — |
| 4 | Round 2 agent | debate-round2.ts | — |
| 5 | Round 3 moderator | debate-moderator.ts | — |
| 6 | Debate orchestrator | debate.ts | — |
| 7 | Social draft agent | social-drafts.ts | — |
| 8 | Pipeline integration | — | pipeline.ts |
| 9 | Social API routes | admin/social-drafts/ | — |
| 10 | Social UI components | admin/ components | — |
| 11 | Social admin page | admin/social/ | — |
| 12 | DebateHighlights | DebateHighlights.tsx | StoryDetail.tsx |
| 13 | Cost display update | — | costs/page.tsx |
| 14 | Migration + deploy | — | — |
