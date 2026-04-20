/**
 * Tests for the Flag 3 (semantic_dedup) Haiku batch scorer.
 *
 * Sends all sources in one Haiku call and gets back a 0-10 uniqueness score
 * per URL. Sources scoring below the threshold (default 4) are demoted to the
 * haiku_summary path by applyUniquenessToPaths in semantic-dedup.ts.
 *
 * Conservative on every fallback path: missing scores, unknown URLs, JSON
 * parse failures, and Haiku call errors all default to score=10 (fully
 * unique \u2192 keep in debate). Better to under-skip than over-skip.
 */

import { describe, it, expect } from 'vitest'
import {
  scoreSourceUniqueness,
  type ClaudeCaller,
  type SourceForUniquenessScoring,
} from '@/agents/source-uniqueness-scorer'

const SAMPLE_SOURCES: SourceForUniquenessScoring[] = [
  { url: 'https://apnews.com/x', outlet: 'AP', title: 'Iran reopens Strait', content: 'Iran reopened the Strait of Hormuz on Friday after the ceasefire took effect.' },
  { url: 'https://reuters.com/x', outlet: 'Reuters', title: 'Iran reopens Strait', content: 'Iran reopened the Strait of Hormuz on Friday after the ceasefire took effect.' },
  { url: 'https://lloyds-list.com/x', outlet: "Lloyd's List", title: 'War-risk premium spikes', content: 'War-risk premiums for Hormuz transits jumped to $14M per voyage according to Lloyd\u2019s underwriters.' },
]

const VALID_JSON = JSON.stringify({
  scores: [
    { url: 'https://apnews.com/x', score: 8 },
    { url: 'https://reuters.com/x', score: 2 }, // duplicate of AP \u2192 low score
    { url: 'https://lloyds-list.com/x', score: 10 }, // unique specialist angle
  ],
})

function fakeCaller(jsonText: string, costUsd = 0.008): ClaudeCaller {
  return async () => ({ text: jsonText, inputTokens: 300, outputTokens: 80, costUsd })
}

describe('scoreSourceUniqueness', () => {
  it('returns one score per input source with a normalized 0-10 integer', async () => {
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'Iran Hormuz', {
      claudeCaller: fakeCaller(VALID_JSON),
    })
    expect(result.scores).toHaveLength(3)
    expect(result.scores[0]).toEqual({ url: 'https://apnews.com/x', score: 8 })
    expect(result.scores[1]).toEqual({ url: 'https://reuters.com/x', score: 2 })
    expect(result.scores[2]).toEqual({ url: 'https://lloyds-list.com/x', score: 10 })
    expect(result.costUsd).toBe(0.008)
  })

  it('returns empty result for empty source list (no API call)', async () => {
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const result = await scoreSourceUniqueness([], 'q', { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(result.scores).toEqual([])
    expect(result.costUsd).toBe(0)
  })

  it('uses HAIKU model and agentType=semantic_dedup_scorer for cost telemetry', async () => {
    let captured: { model?: string; agentType?: string } = {}
    const caller: ClaudeCaller = async (opts) => {
      captured = { model: opts.model, agentType: opts.agentType }
      return { text: JSON.stringify({ scores: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: caller })
    expect(captured.model).toBe('claude-haiku-4-5-20251001')
    expect(captured.agentType).toBe('semantic_dedup_scorer')
  })

  it('passes storyId through for cost-row attribution', async () => {
    let capturedStoryId: string | undefined
    const caller: ClaudeCaller = async (opts) => {
      capturedStoryId = opts.storyId
      return { text: JSON.stringify({ scores: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: caller, storyId: 'story-xyz' })
    expect(capturedStoryId).toBe('story-xyz')
  })

  it('user prompt includes all source URLs + titles + body snippets so Haiku can compare', async () => {
    let userPrompt = ''
    const caller: ClaudeCaller = async (opts) => {
      userPrompt = opts.userPrompt
      return { text: JSON.stringify({ scores: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await scoreSourceUniqueness(SAMPLE_SOURCES, 'Iran Hormuz', { claudeCaller: caller })
    // All URLs visible
    expect(userPrompt).toContain('https://apnews.com/x')
    expect(userPrompt).toContain('https://reuters.com/x')
    expect(userPrompt).toContain('https://lloyds-list.com/x')
    // Titles visible
    expect(userPrompt).toContain('Iran reopens Strait')
    expect(userPrompt).toContain('War-risk premium spikes')
    // Query visible (so Haiku knows the topic context)
    expect(userPrompt).toContain('Iran Hormuz')
  })

  it('clamps scores outside 0-10 to the valid range', async () => {
    const json = JSON.stringify({
      scores: [
        { url: 'https://apnews.com/x', score: 15 },     // too high \u2192 10
        { url: 'https://reuters.com/x', score: -3 },    // too low \u2192 0
        { url: 'https://lloyds-list.com/x', score: 7.6 }, // float \u2192 8 (rounded)
      ],
    })
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: fakeCaller(json) })
    expect(result.scores.find((s) => s.url === 'https://apnews.com/x')!.score).toBe(10)
    expect(result.scores.find((s) => s.url === 'https://reuters.com/x')!.score).toBe(0)
    expect(result.scores.find((s) => s.url === 'https://lloyds-list.com/x')!.score).toBe(8)
  })

  it('defaults missing scores to 10 (conservative \u2014 fully unique, keep in debate)', async () => {
    // Haiku returned only one score. The other two missing default to 10.
    const json = JSON.stringify({
      scores: [{ url: 'https://reuters.com/x', score: 2 }],
    })
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: fakeCaller(json) })
    expect(result.scores).toHaveLength(3)
    expect(result.scores.find((s) => s.url === 'https://apnews.com/x')!.score).toBe(10)
    expect(result.scores.find((s) => s.url === 'https://reuters.com/x')!.score).toBe(2)
    expect(result.scores.find((s) => s.url === 'https://lloyds-list.com/x')!.score).toBe(10)
  })

  it('ignores hallucinated URLs in Haiku response (not in input)', async () => {
    const json = JSON.stringify({
      scores: [
        { url: 'https://apnews.com/x', score: 8 },
        { url: 'https://made-up-url.example/x', score: 0 },
        { url: 'https://reuters.com/x', score: 2 },
        { url: 'https://lloyds-list.com/x', score: 10 },
      ],
    })
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: fakeCaller(json) })
    expect(result.scores).toHaveLength(3)
    expect(result.scores.find((s) => s.url === 'https://made-up-url.example/x')).toBeUndefined()
  })

  it('falls back to all-10 on JSON parse failure (most conservative)', async () => {
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', {
      claudeCaller: fakeCaller('not even close to JSON', 0.003),
    })
    expect(result.scores).toHaveLength(3)
    expect(result.scores.every((s) => s.score === 10)).toBe(true)
    expect(result.costUsd).toBe(0.003)
  })

  it('falls back to all-10 on Haiku call error (no exception thrown)', async () => {
    const caller: ClaudeCaller = async () => {
      throw new Error('Haiku API down')
    }
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: caller })
    expect(result.scores.every((s) => s.score === 10)).toBe(true)
    expect(result.costUsd).toBe(0)
  })

  it('non-numeric scores default to 10', async () => {
    const json = JSON.stringify({
      scores: [
        { url: 'https://apnews.com/x', score: 'high' },
        { url: 'https://reuters.com/x', score: null },
        { url: 'https://lloyds-list.com/x', score: undefined },
      ],
    })
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: fakeCaller(json) })
    expect(result.scores.every((s) => s.score === 10)).toBe(true)
  })

  it('preserves source ordering in output (matches input order, not Haiku response order)', async () => {
    const json = JSON.stringify({
      scores: [
        // Reversed in response
        { url: 'https://lloyds-list.com/x', score: 10 },
        { url: 'https://reuters.com/x', score: 2 },
        { url: 'https://apnews.com/x', score: 8 },
      ],
    })
    const result = await scoreSourceUniqueness(SAMPLE_SOURCES, 'q', { claudeCaller: fakeCaller(json) })
    expect(result.scores.map((s) => s.url)).toEqual(SAMPLE_SOURCES.map((s) => s.url))
  })
})
