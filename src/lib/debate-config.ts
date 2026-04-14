import type { ModelProvider } from '@/lib/models'

export interface DebateModel {
  id: string
  provider: ModelProvider
  model: string
  name: string
}

export const DEBATE_MODELS: Record<string, DebateModel> = {
  analyst_1: { id: 'analyst_1', provider: 'anthropic', model: 'claude-sonnet-4-6', name: 'Claude' },
  analyst_2: { id: 'analyst_2', provider: 'openai', model: 'gpt-5.4', name: 'GPT-5.4' },
  analyst_3: { id: 'analyst_3', provider: 'google', model: 'gemini-2.5-pro', name: 'Gemini' },
  analyst_4: { id: 'analyst_4', provider: 'xai', model: 'grok-4', name: 'Grok' },
}

export const MODERATOR: DebateModel = {
  id: 'moderator',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  name: 'Claude (Moderator)',
}

export const ALL_ANALYST_IDS = ['analyst_1', 'analyst_2', 'analyst_3', 'analyst_4'] as const

export function getAvailableAnalysts(): DebateModel[] {
  const analysts: DebateModel[] = [DEBATE_MODELS.analyst_1]
  if (process.env.OPENAI_API_KEY) analysts.push(DEBATE_MODELS.analyst_2)
  if (process.env.GOOGLE_AI_API_KEY) analysts.push(DEBATE_MODELS.analyst_3)
  if (process.env.XAI_API_KEY) analysts.push(DEBATE_MODELS.analyst_4)
  return analysts
}
