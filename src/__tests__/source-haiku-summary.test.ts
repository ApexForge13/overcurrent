import { describe, it, expect } from 'vitest'
import { summarizeSourcesViaHaiku, type ClaudeCaller, type SourceForHaiku } from '@/lib/source-haiku-summary'

const SAMPLE_SOURCES: SourceForHaiku[] = [
  { url: 'https://newpaper.io/x', outlet: 'NewPaper', title: 'Iran reopens Strait', content: 'Iran reopened the Strait of Hormuz on Friday after the ceasefire took effect.' },
  { url: 'https://random-blog.example/x', outlet: 'RandomBlog', title: 'Naval blockade analysis', content: 'The U.S. naval blockade announcement caught analysts by surprise.' },
]

const VALID_HAIKU_JSON = JSON.stringify({
  framing: 'Two emerging outlets framed Hormuz reopening alongside the U.S. blockade announcement.',
  notableAngles: ['ceasefire trigger', 'analyst surprise'],
  sourceSummaries: [
    { url: 'https://newpaper.io/x', summary: 'NewPaper: Iran reopened Strait after ceasefire.' },
    { url: 'https://random-blog.example/x', summary: 'RandomBlog: blockade caught analysts off guard.' },
  ],
  claims: [
    { claim: 'Iran reopened the Strait after the ceasefire took effect.', confidence: 'MEDIUM', supportedBy: ['NewPaper'] },
  ],
})

function fakeCaller(text: string, costUsd = 0.0123): ClaudeCaller {
  return async () => ({ text, inputTokens: 100, outputTokens: 50, costUsd })
}

describe('summarizeSourcesViaHaiku', () => {
  it('returns a RegionalAnalysis-shaped result with summaries, claims, framing, and cost', async () => {
    const result = await summarizeSourcesViaHaiku('North America', SAMPLE_SOURCES, 'Hormuz blockade', {
      claudeCaller: fakeCaller(VALID_HAIKU_JSON),
    })
    expect(result.region).toBe('North America')
    expect(result.sourceSummaries).toHaveLength(2)
    expect(result.sourceSummaries[0].url).toBe('https://newpaper.io/x')
    expect(result.sourceSummaries[0].summary).toContain('NewPaper')
    expect(result.framingAnalysis.framing).toContain('Two emerging outlets')
    expect(result.framingAnalysis.notableAngles).toContain('ceasefire trigger')
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0].confidence).toBe('MEDIUM')
    expect(result.discrepancies).toEqual([])
    expect(result.omissions).toEqual([])
    expect(result.costUsd).toBe(0.0123)
  })

  it('returns an empty RegionalAnalysis stub for empty source list (no API call)', async () => {
    let called = false
    const caller: ClaudeCaller = async () => {
      called = true
      return { text: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const result = await summarizeSourcesViaHaiku('Europe', [], 'q', { claudeCaller: caller })
    expect(called).toBe(false)
    expect(result.claims).toEqual([])
    expect(result.sourceSummaries).toEqual([])
    expect(result.costUsd).toBe(0)
    expect(result.framingAnalysis.framing).toBe('')
  })

  it('uses HAIKU model and agentType=tiered_haiku_summary so cost telemetry is filterable', async () => {
    let captured: { model?: string; agentType?: string; region?: string } = {}
    const caller: ClaudeCaller = async (opts) => {
      captured = { model: opts.model, agentType: opts.agentType, region: opts.region }
      return { text: VALID_HAIKU_JSON, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await summarizeSourcesViaHaiku('Asia', SAMPLE_SOURCES, 'q', { claudeCaller: caller })
    expect(captured.model).toBe('claude-haiku-4-5-20251001')
    expect(captured.agentType).toBe('tiered_haiku_summary')
    expect(captured.region).toBe('Asia')
  })

  it('passes storyId through for cost-row attribution when provided', async () => {
    let capturedStoryId: string | undefined
    const caller: ClaudeCaller = async (opts) => {
      capturedStoryId = opts.storyId
      return { text: VALID_HAIKU_JSON, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    await summarizeSourcesViaHaiku('Asia', SAMPLE_SOURCES, 'q', {
      claudeCaller: caller,
      storyId: 'story-abc',
    })
    expect(capturedStoryId).toBe('story-abc')
  })

  it('handles malformed JSON by returning a minimal stub instead of throwing', async () => {
    const result = await summarizeSourcesViaHaiku('Africa', SAMPLE_SOURCES, 'q', {
      claudeCaller: fakeCaller('not even close to JSON'),
    })
    // Cost still billed, but the stub has no claims/framings
    expect(result.region).toBe('Africa')
    expect(result.claims).toEqual([])
    // Source summaries fall back to a generic per-source line so the URL list is preserved
    expect(result.sourceSummaries).toHaveLength(2)
    expect(result.framingAnalysis.framing).toMatch(/parse|insufficient|empty/i)
  })

  it('clamps unknown confidence values to MEDIUM (so synthesis never sees garbage)', async () => {
    const json = JSON.stringify({
      framing: 'x',
      notableAngles: [],
      sourceSummaries: [],
      claims: [
        { claim: 'a', confidence: 'GARBAGE', supportedBy: ['NewPaper'] },
        { claim: 'b', confidence: 'high', supportedBy: ['RandomBlog'] }, // lowercase
      ],
    })
    const result = await summarizeSourcesViaHaiku('Europe', SAMPLE_SOURCES, 'q', {
      claudeCaller: fakeCaller(json),
    })
    expect(result.claims[0].confidence).toBe('MEDIUM')
    expect(result.claims[1].confidence).toBe('HIGH') // case-normalized
  })

  it('preserves source ordering in sourceSummaries even when Haiku reorders them', async () => {
    const json = JSON.stringify({
      framing: 'x',
      notableAngles: [],
      sourceSummaries: [
        { url: 'https://random-blog.example/x', summary: 'B' }, // reversed
        { url: 'https://newpaper.io/x', summary: 'A' },
      ],
      claims: [],
    })
    const result = await summarizeSourcesViaHaiku('NA', SAMPLE_SOURCES, 'q', {
      claudeCaller: fakeCaller(json),
    })
    // Result should match input ordering, not Haiku response ordering
    expect(result.sourceSummaries.map((s) => s.url)).toEqual([
      'https://newpaper.io/x',
      'https://random-blog.example/x',
    ])
  })
})
