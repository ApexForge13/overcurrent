/**
 * Signal category classifier.
 *
 * The existing `Story.primaryCategory` uses 9 broad buckets for public display.
 * The predictive signal layer needs narrower categories — spec defines 8:
 *   trade_dispute | military_conflict | election_coverage | corporate_scandal
 *   diplomatic_negotiation | civil_unrest | economic_policy | environmental_event
 *
 * This file provides a dedicated Haiku classifier that maps a story to ONE of
 * these 8 signal categories. Separate from primaryCategory (kept for public
 * display). Cost: ~$0.0005 per analysis.
 *
 * MIN_SIGNAL: classification itself is reliable at N=1.
 *             Downstream StoryCategoryPattern aggregation needs 10+ analyses
 *             in a category before patterns are meaningful.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'

export const SIGNAL_CATEGORIES = [
  'trade_dispute',
  'military_conflict',
  'election_coverage',
  'corporate_scandal',
  'diplomatic_negotiation',
  'civil_unrest',
  'economic_policy',
  'environmental_event',
] as const

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number]

const SYSTEM_PROMPT = `You classify news stories into ONE of 8 signal categories for Overcurrent's predictive layer.

Categories (lowercase, underscore):
- trade_dispute: tariffs, trade wars, import/export restrictions, trade agreements
- military_conflict: active warfare, military strikes, invasions, armed confrontation, blockades
- election_coverage: elections, election results, candidate announcements, campaign events
- corporate_scandal: corporate fraud, executive misconduct, company collapses, regulatory actions against companies
- diplomatic_negotiation: peace talks, summits, treaties, diplomatic visits, negotiations between states
- civil_unrest: protests, riots, strikes, civil disobedience, mass demonstrations
- economic_policy: interest rates, fiscal policy, regulatory changes, monetary announcements
- environmental_event: natural disasters, climate events, pollution, environmental disasters

Rules:
- Pick exactly ONE category. Don't combine.
- If the story spans multiple categories, pick the DOMINANT angle (the one driving the headline).
- "Military conflict" takes precedence over "diplomatic_negotiation" when active fighting is happening.
- "Election_coverage" beats "civil_unrest" when the primary story is a vote, even if there are protests.

Response: ONLY a JSON object, nothing else. Format:
{ "signalCategory": "one_of_the_8", "confidence": 0.0-1.0, "reasoning": "1 sentence" }`

export interface SignalCategoryResult {
  signalCategory: SignalCategory
  confidence: number
  reasoning: string
  costUsd: number
}

/**
 * Classify a story into one of 8 signal categories.
 * Cheap Haiku call (~$0.0005).
 */
export async function classifySignalCategory(
  headline: string,
  synopsis: string,
  storyId?: string,
): Promise<SignalCategoryResult> {
  const userPrompt = `Headline: ${headline}\n\nSynopsis: ${synopsis}\n\nClassify into one signal category. Respond with JSON only.`

  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'signal_category',
      maxTokens: 256,
      storyId,
    })

    const parsed = parseJSON<{ signalCategory: string; confidence: number; reasoning: string }>(result.text)

    // Validate category value
    const category = parsed.signalCategory as SignalCategory
    if (!SIGNAL_CATEGORIES.includes(category)) {
      console.warn(`[signalCategory] Haiku returned invalid category '${parsed.signalCategory}', defaulting to civil_unrest`)
      return {
        signalCategory: 'civil_unrest',
        confidence: 0,
        reasoning: `fallback: invalid AI output "${parsed.signalCategory}"`,
        costUsd: result.costUsd,
      }
    }

    return {
      signalCategory: category,
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reasoning: parsed.reasoning ?? '',
      costUsd: result.costUsd,
    }
  } catch (err) {
    console.error('[signalCategory] Classification failed:', err instanceof Error ? err.message : err)
    return {
      signalCategory: 'civil_unrest', // safest fallback — broadest category
      confidence: 0,
      reasoning: `fallback: ${err instanceof Error ? err.message : 'unknown error'}`,
      costUsd: 0,
    }
  }
}
