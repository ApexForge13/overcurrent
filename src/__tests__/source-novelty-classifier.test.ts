/**
 * Tests for the Flag 2 (arc_rerun_differential) Haiku classifier.
 *
 * The classifier reads the previous analysis context + each source's
 * publishedAt + title/content snippet, and labels each source as either
 * "new_since_last_run" (full debate) or "continuing_coverage" (haiku summary).
 *
 * Single Haiku call batch-classifies all sources for cost efficiency.
 */

import { describe, it, expect } from 'vitest'
import {
  classifySourceNovelty,
  type ClaudeCaller,
  type ClassifierBaseline,
  type SourceForNoveltyClassification,
} from '@/agents/source-novelty-classifier'

const BASELINE: ClassifierBaseline = {
  previousAnalysisCreatedAt: new Date('2026-04-15T10:00:00Z'),
  previousHeadline: 'Iran reopens Strait of Hormuz briefly before re-closing',
  previousKeyClaims: [
    'Iran reopened the Strait then re-closed within 24 hours',
    'IRGC fired on India-flagged tankers',
    'Brent crude surged past $100',
  ],
}

const SAMPLE_SOURCES: SourceForNoveltyClassification[] = [
  { url: 'https://apnews.com/new', title: 'Iran proposes new uranium-monitoring deal', publishedAt: '2026-04-19T12:00:00Z', content: 'Tehran offered a new monitoring framework on Saturday...' },
  { url: 'https://apnews.com/recap', title: 'Recap: 24-hour Strait reopening saga', publishedAt: '2026-04-19T08:00:00Z', content: 'On April 14, Iran briefly reopened the Strait then re-closed it...' },
  { url: 'https://reuters.com/new', title: 'New US-Iran channel via Pakistan', publishedAt: '2026-04-19T09:00:00Z', content: 'Pakistan\u2019s foreign minister said Saturday a new direct channel...' },
]

function fakeCaller(jsonText: string, costUsd = 0.005): ClaudeCaller {
  return async () => ({ text: jsonText, inputTokens: 200, outputTokens: 100, costUsd })
}

describe('classifySourceNovelty', () => {
  it('returns a classification per input source with novelty label', async () => {
    const json = JSON.stringify({
      classifications: [
        { url: 'https://apnews.com/new', novelty: 'new_since_last_run' },
        { url: 'https://apnews.com/recap', novelty: 'continuing_coverage' },
        { url: 'https://reuters.com/new', novelty: 'new_since_last_run' },
      ],
    })
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'Iran Hormuz', {
      claudeCaller: fakeCaller(json),
    })
    expect(result.classifications).toHaveLength(3)
    expect(result.classifications[0]).toEqual({ url: 'https://apnews.com/new', novelty: 'new_since_last_run' })
    expect(result.classifications[1]).toEqual({ url: 'https://apnews.com/recap', novelty: 'continuing_coverage' })
    expect(result.classifications[2]).toEqual({ url: 'https://reuters.com/new', novelty: 'new_since_last_run' })
    expect(result.costUsd).toBe(0.005)
  })

  it('returns an empty result for empty source list (no API call)', async () => {
    let invoked = false
    const caller: ClaudeCaller = async () => {
      invoked = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const result = await classifySourceNovelty([], BASELINE, 'q', { claudeCaller: caller })
    expect(invoked).toBe(false)
    expect(result.classifications).toEqual([])
    expect(result.costUsd).toBe(0)
  })

  it('uses HAIKU model and agentType=arc_rerun_novelty so cost telemetry is filterable', async () => {
    let captured: { model?: string; agentType?: string } = {}
    const caller: ClaudeCaller = async (opts) => {
      captured = { model: opts.model, agentType: opts.agentType }
      return { text: JSON.stringify({ classifications: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', { claudeCaller: caller })
    expect(captured.model).toBe('claude-haiku-4-5-20251001')
    expect(captured.agentType).toBe('arc_rerun_novelty')
  })

  it('passes storyId through for cost-row attribution', async () => {
    let capturedStoryId: string | undefined
    const caller: ClaudeCaller = async (opts) => {
      capturedStoryId = opts.storyId
      return { text: JSON.stringify({ classifications: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: caller,
      storyId: 'story-abc',
    })
    expect(capturedStoryId).toBe('story-abc')
  })

  it('user prompt includes baseline headline + claims + source publishedAt for each input', async () => {
    let userPrompt = ''
    const caller: ClaudeCaller = async (opts) => {
      userPrompt = opts.userPrompt
      return { text: JSON.stringify({ classifications: [] }), inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'Iran Hormuz', { claudeCaller: caller })
    // Prompt must include the baseline headline so Haiku knows what's "prior"
    expect(userPrompt).toContain('Iran reopens Strait of Hormuz briefly')
    // And each prior key claim
    expect(userPrompt).toContain('IRGC fired on India-flagged tankers')
    // And the previous-analysis timestamp so Haiku can reason about freshness
    expect(userPrompt).toContain('2026-04-15')
    // And each source URL + publishedAt
    expect(userPrompt).toContain('https://apnews.com/new')
    expect(userPrompt).toContain('2026-04-19T12:00:00Z')
  })

  it('defaults missing classifications to continuing_coverage (conservative — no extra debate spend)', async () => {
    // Haiku returned only 1 of 3 expected classifications. The 2 missing
    // sources default to continuing_coverage so they fall to haiku summary
    // (cheaper). Better to under-debate than over-classify as new.
    const json = JSON.stringify({
      classifications: [
        { url: 'https://apnews.com/new', novelty: 'new_since_last_run' },
      ],
    })
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: fakeCaller(json),
    })
    expect(result.classifications).toHaveLength(3)
    expect(result.classifications.find((c) => c.url === 'https://apnews.com/new')?.novelty).toBe('new_since_last_run')
    expect(result.classifications.find((c) => c.url === 'https://apnews.com/recap')?.novelty).toBe('continuing_coverage')
    expect(result.classifications.find((c) => c.url === 'https://reuters.com/new')?.novelty).toBe('continuing_coverage')
  })

  it('ignores extra URLs in Haiku response that were not in the input', async () => {
    const json = JSON.stringify({
      classifications: [
        { url: 'https://apnews.com/new', novelty: 'new_since_last_run' },
        { url: 'https://hallucinated.com/x', novelty: 'new_since_last_run' },
        { url: 'https://apnews.com/recap', novelty: 'continuing_coverage' },
        { url: 'https://reuters.com/new', novelty: 'continuing_coverage' },
      ],
    })
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: fakeCaller(json),
    })
    // Only the 3 input URLs should be in the output
    expect(result.classifications).toHaveLength(3)
    expect(result.classifications.map((c) => c.url).sort()).toEqual(
      SAMPLE_SOURCES.map((s) => s.url).sort(),
    )
    expect(result.classifications.find((c) => c.url === 'https://hallucinated.com/x')).toBeUndefined()
  })

  it('clamps unknown novelty values to continuing_coverage (conservative default)', async () => {
    const json = JSON.stringify({
      classifications: [
        { url: 'https://apnews.com/new', novelty: 'GARBAGE_VALUE' },
        { url: 'https://apnews.com/recap', novelty: 'NEW_SINCE_LAST_RUN' }, // wrong case
        { url: 'https://reuters.com/new', novelty: 'continuing_coverage' },
      ],
    })
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: fakeCaller(json),
    })
    // Garbage → continuing
    expect(result.classifications.find((c) => c.url === 'https://apnews.com/new')?.novelty).toBe('continuing_coverage')
    // Wrong-case but valid term → normalized
    expect(result.classifications.find((c) => c.url === 'https://apnews.com/recap')?.novelty).toBe('new_since_last_run')
    // Valid → preserved
    expect(result.classifications.find((c) => c.url === 'https://reuters.com/new')?.novelty).toBe('continuing_coverage')
  })

  it('falls back to all-continuing on JSON parse failure (most conservative)', async () => {
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: fakeCaller('not even close to JSON', 0.003),
    })
    expect(result.classifications).toHaveLength(3)
    expect(result.classifications.every((c) => c.novelty === 'continuing_coverage')).toBe(true)
    expect(result.costUsd).toBe(0.003) // still bills the failed call
  })

  it('falls back to all-continuing on Haiku call error (no exception thrown)', async () => {
    const caller: ClaudeCaller = async () => {
      throw new Error('Haiku API down')
    }
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: caller,
    })
    expect(result.classifications.every((c) => c.novelty === 'continuing_coverage')).toBe(true)
    expect(result.costUsd).toBe(0)
  })

  it('preserves source ordering in output (matches input order)', async () => {
    const json = JSON.stringify({
      classifications: [
        // Reversed order in response
        { url: 'https://reuters.com/new', novelty: 'continuing_coverage' },
        { url: 'https://apnews.com/recap', novelty: 'continuing_coverage' },
        { url: 'https://apnews.com/new', novelty: 'new_since_last_run' },
      ],
    })
    const result = await classifySourceNovelty(SAMPLE_SOURCES, BASELINE, 'q', {
      claudeCaller: fakeCaller(json),
    })
    expect(result.classifications.map((c) => c.url)).toEqual([
      'https://apnews.com/new',
      'https://apnews.com/recap',
      'https://reuters.com/new',
    ])
  })
})
