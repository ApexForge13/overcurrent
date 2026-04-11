import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '@/lib/db'

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
export type ModelTier = 'fast' | 'deep'

const MODEL_MAP: Record<ModelProvider, Record<ModelTier, string>> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', deep: 'claude-sonnet-4-20250514' },
  openai:    { fast: 'gpt-4o-mini', deep: 'gpt-4o' },
  google:    { fast: 'gemini-2.0-flash', deep: 'gemini-2.5-pro' },
  xai:       { fast: 'grok-3-mini', deep: 'grok-3' },
}

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

async function checkDailyCostCap(): Promise<void> {
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
  await checkDailyCostCap()

  const model = MODEL_MAP[options.provider]?.[options.tier]
  if (!model) throw new Error(`Unknown provider/tier: ${options.provider}/${options.tier}`)
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
    const genModel = client.getGenerativeModel({ model, systemInstruction: options.system })
    const response = await genModel.generateContent(options.userMessage)
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
