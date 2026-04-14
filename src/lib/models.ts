import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { withRetry } from '@/lib/anthropic'

// Lazy-init clients
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
    xaiClient = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' })
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

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'xai'
export type ModelTier = 'fast' | 'deep' | 'premium'

const MODEL_MAP: Record<ModelProvider, Record<ModelTier, string>> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', deep: 'claude-sonnet-4-6', premium: 'claude-opus-4-6' },
  openai:    { fast: 'gpt-4o-mini', deep: 'gpt-5.4', premium: 'gpt-5.4' },
  google:    { fast: 'gemini-2.0-flash', deep: 'gemini-2.5-pro', premium: 'gemini-2.5-pro' },
  xai:       { fast: 'grok-3-mini', deep: 'grok-4', premium: 'grok-4' },
}

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  'claude-sonnet-4-20250514':  { input: 3.0, output: 15.0 },   // legacy
  'claude-opus-4-20250514':    { input: 15.0, output: 75.0 },  // legacy
  'claude-sonnet-4-6':           { input: 3.0, output: 15.0 },
  'claude-opus-4-6':             { input: 5.0, output: 25.0 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60 },
  'gpt-4o':                    { input: 2.50, output: 10.0 },
  'gpt-5.4':                   { input: 2.50, output: 10.0 },
  'gemini-2.0-flash':          { input: 0.10, output: 0.40 },
  'gemini-2.5-pro':            { input: 1.25, output: 10.0 },
  'grok-3-mini':               { input: 0.30, output: 0.50 },
  'grok-3':                    { input: 3.0, output: 15.0 },  // legacy
  'grok-4':                    { input: 3.0, output: 15.0 },
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

export async function callModel(options: ModelCallOptions): Promise<ModelCallResult> {

  const model = MODEL_MAP[options.provider]?.[options.tier]
  if (!model) throw new Error(`Unknown provider/tier: ${options.provider}/${options.tier}`)
  const maxTokens = options.maxTokens ?? 4096

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  const retryLabel = `callModel(${options.provider}/${model}, ${options.agentType})`
  const retryDelay = options.provider === 'google' ? 10_000 : undefined

  if (options.provider === 'anthropic') {
    const client = getAnthropic()
    const useStreaming = model.includes('opus') || maxTokens > 8192

    if (useStreaming) {
      const finalMessage = await withRetry(async () => {
        const stream = await client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: options.system,
          messages: [{ role: 'user', content: options.userMessage }],
        })
        return stream.finalMessage()
      }, retryLabel, retryDelay)

      text = finalMessage.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      inputTokens = finalMessage.usage.input_tokens
      outputTokens = finalMessage.usage.output_tokens
    } else {
      const response = await withRetry(() => client.messages.create({
        model,
        max_tokens: maxTokens,
        system: options.system,
        messages: [{ role: 'user', content: options.userMessage }],
      }), retryLabel, retryDelay)

      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      inputTokens = response.usage.input_tokens
      outputTokens = response.usage.output_tokens
    }

  } else if (options.provider === 'openai' || options.provider === 'xai') {
    const client = options.provider === 'xai' ? getXAI() : getOpenAI()
    // GPT-5.x uses max_completion_tokens instead of max_tokens
    const tokenParam = model.startsWith('gpt-5')
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }

    const response = await withRetry(() => client.chat.completions.create({
      model,
      ...tokenParam,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.userMessage },
      ],
    }), retryLabel, retryDelay)

    text = response.choices[0]?.message?.content ?? ''
    inputTokens = response.usage?.prompt_tokens ?? 0
    outputTokens = response.usage?.completion_tokens ?? 0

  } else if (options.provider === 'google') {
    const client = getGoogle()
    const genModel = client.getGenerativeModel({ model, systemInstruction: options.system })
    const response = await withRetry(() => genModel.generateContent(options.userMessage), retryLabel, retryDelay)

    text = response.response.text()
    inputTokens = response.response.usageMetadata?.promptTokenCount ?? 0
    outputTokens = response.response.usageMetadata?.candidatesTokenCount ?? 0
  }

  // Cost calculation
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

export function getAvailableProviders(): ModelProvider[] {
  const providers: ModelProvider[] = ['anthropic']
  if (process.env.OPENAI_API_KEY) providers.push('openai')
  if (process.env.GOOGLE_AI_API_KEY) providers.push('google')
  if (process.env.XAI_API_KEY) providers.push('xai')
  return providers
}

export { parseJSON } from '@/lib/anthropic'
