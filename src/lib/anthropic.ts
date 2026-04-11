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
  let stripped = text
    .replace(/^```(?:json)?\s*\n?/gi, '')
    .replace(/\n?```\s*$/gi, '')
    .trim()

  // Try direct parse
  try {
    return JSON.parse(stripped) as T
  } catch {
    // pass
  }

  // Try extracting JSON object via regex
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0]) as T
    } catch {
      // Try fixing truncated JSON — close open brackets/braces
      let fixable = match[0]
      const openBraces = (fixable.match(/\{/g) || []).length
      const closeBraces = (fixable.match(/\}/g) || []).length
      const openBrackets = (fixable.match(/\[/g) || []).length
      const closeBrackets = (fixable.match(/\]/g) || []).length

      // Remove trailing comma before closing
      fixable = fixable.replace(/,\s*$/, '')

      // Close unclosed arrays/objects
      for (let i = 0; i < openBrackets - closeBrackets; i++) fixable += ']'
      for (let i = 0; i < openBraces - closeBraces; i++) fixable += '}'

      try {
        return JSON.parse(fixable) as T
      } catch {
        // pass
      }
    }
  }

  throw new Error('Failed to parse JSON from response')
}
