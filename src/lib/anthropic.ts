import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'

// ---------------------------------------------------------------------------
// Models & pricing
// ---------------------------------------------------------------------------

export const HAIKU = 'claude-haiku-4-5-20251001' as const
export const SONNET = 'claude-sonnet-4-6' as const
export const OPUS = 'claude-opus-4-6' as const

type Model = typeof HAIKU | typeof SONNET | typeof OPUS

const PRICING: Record<Model, { input: number; output: number }> = {
  [HAIKU]:  { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  [SONNET]: { input: 3.0 / 1_000_000,  output: 15.0 / 1_000_000 },
  [OPUS]:   { input: 5.0 / 1_000_000,  output: 25.0 / 1_000_000 },
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
// Retry helper — handles overloaded_error, rate limits, 529
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5
const BASE_DELAY_MS = 5_000 // 5s, 10s, 20s, 40s, 80s
const SYNTHESIS_DELAY_MS = 10_000 // 10s, 20s, 40s, 80s, 160s — longer for big prompts

function isRetryable(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    // Anthropic SDK errors — status codes
    if (e.status === 529 || e.status === 503 || e.status === 429 || e.status === 500) return true
    // Message-based detection (all providers)
    // "terminated" = Anthropic SDK stream dropped mid-generation (MessageStream.ts)
    if (typeof e.message === 'string' && /overloaded|rate.?limit|capacity|too many|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|terminated|stream.*closed|connection.*reset|aborted/i.test(e.message)) return true
    // Nested error shape from API response
    const inner = e.error as Record<string, unknown> | undefined
    if (inner?.type === 'overloaded_error') return true
    // Anthropic SDK APIConnectionError (network failures)
    const ctorName = e.constructor && (e.constructor as { name?: string }).name
    if (ctorName === 'APIConnectionError' || ctorName === 'APIConnectionTimeoutError') return true
  }
  return false
}

export async function withRetry<T>(fn: () => Promise<T>, label: string, baseDelay?: number): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        const delay = (baseDelay ?? BASE_DELAY_MS) * Math.pow(2, attempt)
        console.warn(`[retry] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed (retryable). Waiting ${delay / 1000}s...`)
        await new Promise(r => setTimeout(r, delay))
      } else {
        throw err
      }
    }
  }
  throw lastErr
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

  // --- API call (use streaming for large/slow models) ---
  const maxTokens = options.maxTokens ?? 4096
  const useStreaming = model === OPUS || maxTokens > 8192

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  // Log prompt size for debugging oversized inputs
  const promptChars = systemPrompt.length + userPrompt.length
  const estimatedTokens = Math.ceil(promptChars / 3.5) // rough estimate
  console.log(`[callClaude] ${agentType} | model=${model} | ~${estimatedTokens.toLocaleString()} input tokens (${(promptChars / 1024).toFixed(0)}KB) | maxTokens=${maxTokens}`)

  const retryLabel = `callClaude(${model}, ${agentType})`
  // Use longer backoff for synthesis — large prompts need more breathing room
  const baseDelay = agentType === 'synthesis' ? SYNTHESIS_DELAY_MS : undefined

  if (useStreaming) {
    let finalMessage: Anthropic.Message | undefined
    try {
      finalMessage = await withRetry(async () => {
        const stream = await client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })
        return stream.finalMessage()
      }, retryLabel, baseDelay)
    } catch (streamErr) {
      // Streaming failed after all retries — fall back to non-streaming as last resort
      console.warn(`[callClaude] Streaming failed after ${MAX_RETRIES} retries for ${agentType}. Falling back to non-streaming...`)
      finalMessage = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
    }

    text = finalMessage.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n') || ''
    inputTokens = finalMessage.usage.input_tokens
    outputTokens = finalMessage.usage.output_tokens
  } else {
    const response = await withRetry(() => client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }), retryLabel, baseDelay)

    text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n') || ''
    inputTokens = response.usage.input_tokens
    outputTokens = response.usage.output_tokens
  }

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

  // Pre-clean: fix common LLM JSON mistakes
  function cleanJson(s: string): string {
    return s
      // Remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1')
      // Replace single quotes around keys/values with double quotes (heuristic)
      .replace(/(?<=[\[{,]\s*)'([^']+)'(?=\s*:)/g, '"$1"')
  }

  // Try direct parse
  try {
    return JSON.parse(stripped) as T
  } catch {
    // Try cleaned version
    try {
      return JSON.parse(cleanJson(stripped)) as T
    } catch {
      // pass
    }
  }

  // Try extracting JSON object via regex
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0]) as T
    } catch {
      try {
        return JSON.parse(cleanJson(match[0])) as T
      } catch {
        // Try fixing truncated JSON — close open brackets/braces
        let fixable = cleanJson(match[0])
        const openBraces = (fixable.match(/\{/g) || []).length
        const closeBraces = (fixable.match(/\}/g) || []).length
        const openBrackets = (fixable.match(/\[/g) || []).length
        const closeBrackets = (fixable.match(/\]/g) || []).length

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
  }

  // Try extracting JSON array via regex
  const arrayMatch = stripped.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T
    } catch {
      try {
        return JSON.parse(cleanJson(arrayMatch[0])) as T
      } catch {
        // Try closing unclosed brackets
        let fixable = cleanJson(arrayMatch[0])
        const openBrackets = (fixable.match(/\[/g) || []).length
        const closeBrackets = (fixable.match(/\]/g) || []).length
        const openBraces = (fixable.match(/\{/g) || []).length
        const closeBraces = (fixable.match(/\}/g) || []).length
        for (let i = 0; i < openBraces - closeBraces; i++) fixable += '}'
        for (let i = 0; i < openBrackets - closeBrackets; i++) fixable += ']'
        try {
          return JSON.parse(fixable) as T
        } catch {
          // pass
        }
      }
    }
  }

  // Last resort: extract individual JSON objects from text and wrap in a triage-like structure
  const objectMatches = [...stripped.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)]
  if (objectMatches.length > 0) {
    const objects: unknown[] = []
    for (const m of objectMatches) {
      try {
        objects.push(JSON.parse(cleanJson(m[0])))
      } catch {
        // skip unparseable objects
      }
    }
    if (objects.length > 0) {
      // If we got individual source objects, wrap them
      const first = objects[0] as Record<string, unknown>
      if (first.url || first.sources) {
        if (first.sources) return first as T
        return { sources: objects } as T
      }
      // Return the first valid object
      return first as T
    }
  }

  throw new Error('Failed to parse JSON from response')
}
