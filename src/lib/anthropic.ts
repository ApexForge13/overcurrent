import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'

// ---------------------------------------------------------------------------
// Models & pricing
// ---------------------------------------------------------------------------

export const HAIKU = 'claude-haiku-4-5-20251001' as const
export const SONNET = 'claude-sonnet-4-20250514' as const

type Model = typeof HAIKU | typeof SONNET

const PRICING: Record<Model, { input: number; output: number }> = {
  [HAIKU]:  { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  [SONNET]: { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000 },
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

const client = new Anthropic()

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export async function getDailyCost(): Promise<number> {
  const { start, end } = todayRange()
  const result = await prisma.costLog.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: start, lte: end } },
  })
  return result._sum.costUsd ?? 0
}

export async function getTotalCost(): Promise<number> {
  const result = await prisma.costLog.aggregate({
    _sum: { costUsd: true },
  })
  return result._sum.costUsd ?? 0
}

// ---------------------------------------------------------------------------
// Main API wrapper
// ---------------------------------------------------------------------------

interface CallClaudeOptions {
  model: Model
  systemPrompt: string
  userPrompt: string
  agentType: string
  maxTokens?: number
  region?: string
  storyId?: string
  undercurrentReportId?: string
}

interface CallClaudeResult {
  text: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export async function callClaude(options: CallClaudeOptions): Promise<CallClaudeResult> {
  const {
    model,
    systemPrompt,
    userPrompt,
    agentType,
    region,
    storyId,
    undercurrentReportId,
  } = options

  // --- Cost cap check ---
  const cap = parseFloat(process.env.DAILY_COST_CAP ?? '15')
  const dailyCost = await getDailyCost()
  if (dailyCost >= cap) {
    throw new Error(
      `Daily cost cap reached ($${dailyCost.toFixed(4)} / $${cap.toFixed(2)}). ` +
      'Refusing to make further API calls today.',
    )
  }

  // --- API call ---
  const maxTokens = options.maxTokens ?? 4096
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text =
    response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n') || ''

  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens

  // --- Cost calculation ---
  const pricing = PRICING[model]
  const costUsd =
    inputTokens * pricing.input + outputTokens * pricing.output

  // --- Log to DB ---
  await prisma.costLog.create({
    data: {
      model,
      agentType,
      inputTokens,
      outputTokens,
      costUsd,
      region: region ?? null,
      storyId: storyId ?? null,
      undercurrentReportId: undercurrentReportId ?? null,
    },
  })

  return { text, inputTokens, outputTokens, costUsd }
}

// ---------------------------------------------------------------------------
// JSON parse helper
// ---------------------------------------------------------------------------

export function parseJSON<T = unknown>(text: string): T {
  // Strip markdown code fences if present
  const stripped = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()

  try {
    return JSON.parse(stripped) as T
  } catch {
    // Fallback: extract first JSON object via regex
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0]) as T
      } catch {
        // fall through
      }
    }
    throw new Error('Failed to parse JSON from response')
  }
}
