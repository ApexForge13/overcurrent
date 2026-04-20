import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { secEdgarRunner } from '@/lib/raw-signals/integrations/sec-edgar'
import type { RunnerContext } from '@/lib/raw-signals/runner'
import * as anthropic from '@/lib/anthropic'

// Fixed "today" — firstDetectedAt — used across the cluster so the 30-day
// pre-window math is deterministic without date-drift flakiness.
const TODAY = new Date('2026-04-15T12:00:00Z')

function makeCtx(overrides?: Partial<RunnerContext['cluster']>): RunnerContext {
  return {
    queueId: 'q-sec-1',
    storyClusterId: 'cluster-sec-1',
    umbrellaArcId: null,
    signalType: 'sec_filing',
    triggerLayer: 'entity_trigger',
    triggerReason: 'ticker_entity_present',
    approvedByAdmin: false,
    cluster: {
      id: 'cluster-sec-1',
      headline: 'Insider activity at Acme Corp',
      synopsis: 'Multiple filings flagged at Acme Corp over the past quarter.',
      firstDetectedAt: TODAY,
      entities: ['Acme Corporation', 'Globex Industries', 'Initech Holdings'],
      signalCategory: 'corporate_scandal',
      ...overrides,
    },
  }
}

/**
 * Build an EDGAR full-text search response with the given hits. Each hit
 * needs `_source.form`, `_source.adsh`, `_source.file_date`,
 * `_source.display_names`, and optionally `_source.tickers`.
 */
function edgarSearchResponse(
  hits: Array<{
    form: string
    adsh: string
    file_date: string
    display_names: string[]
    tickers?: string[]
    ciks?: string[]
    period_of_report?: string
  }>,
) {
  return {
    hits: {
      hits: hits.map((h) => ({ _source: h })),
    },
  }
}

function daysBefore(base: Date, days: number): string {
  const d = new Date(base.getTime() - days * 24 * 60 * 60 * 1000)
  return d.toISOString().split('T')[0]
}

describe('secEdgarRunner', () => {
  let originalUA: string | undefined

  beforeEach(() => {
    originalUA = process.env.SEC_EDGAR_USER_AGENT
    process.env.SEC_EDGAR_USER_AGENT = 'Overcurrent-Test/1.0 test@example.com'
  })

  afterEach(() => {
    if (originalUA === undefined) delete process.env.SEC_EDGAR_USER_AGENT
    else process.env.SEC_EDGAR_USER_AGENT = originalUA
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns high confidence with bucketed form4/13F/13D arrays when EDGAR returns ≥3 hits across form types', async () => {
    const hits = [
      {
        form: '4',
        adsh: '0001234567-26-000001',
        file_date: daysBefore(TODAY, 10),
        display_names: ['Acme Corporation (CIK 0000123)'],
        ciks: ['0000000123'],
        tickers: ['ACME'],
      },
      {
        form: '13F-HR',
        adsh: '0001234567-26-000002',
        file_date: daysBefore(TODAY, 40),
        display_names: ['Big Fund LP (CIK 0000456)'],
        ciks: ['0000000456'],
        period_of_report: daysBefore(TODAY, 60),
      },
      {
        form: 'SC 13D',
        adsh: '0001234567-26-000003',
        file_date: daysBefore(TODAY, 20),
        display_names: ['Activist Capital (CIK 0000789)'],
        ciks: ['0000000789'],
        tickers: ['ACME'],
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(edgarSearchResponse(hits)),
      }),
    )
    vi.spyOn(anthropic, 'callClaude').mockResolvedValue({
      text: JSON.stringify({
        filingsRelevant: 3,
        materialFilings: 2,
        addsMissingContext: false,
        gapDescription: '',
      }),
      costUsd: 0.001,
      model: anthropic.HAIKU,
      usage: { input_tokens: 100, output_tokens: 50 },
    } as never)

    const result = await secEdgarRunner(makeCtx())
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('sec-edgar')
    expect(result!.confidenceLevel).toBe('high')
    const payload = result!.rawContent as {
      form4Trades: Array<{ accessionNumber: string; filerName: string; ticker?: string }>
      f13Holdings: Array<{ accessionNumber: string; filerName: string }>
      d13Filings: Array<{ accessionNumber: string; filerName: string; formType: string }>
    }
    expect(Array.isArray(payload.form4Trades)).toBe(true)
    expect(Array.isArray(payload.f13Holdings)).toBe(true)
    expect(Array.isArray(payload.d13Filings)).toBe(true)
    expect(payload.form4Trades.length).toBeGreaterThanOrEqual(1)
    expect(payload.f13Holdings.length).toBeGreaterThanOrEqual(1)
    expect(payload.d13Filings.length).toBeGreaterThanOrEqual(1)
  })

  it('writes auth_failed error row when EDGAR returns 403 (User-Agent rejection)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    )
    const result = await secEdgarRunner(makeCtx())
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('sec-edgar')
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorVersion: number
      errorType: string
      provider: string
      rawSignalQueueId?: string
    }
    expect(payload.errorVersion).toBe(1)
    expect(payload.errorType).toBe('auth_failed')
    expect(payload.provider).toBe('sec_edgar')
    expect(payload.rawSignalQueueId).toBe('q-sec-1')
  })

  it('writes rate_limited error row with retryAfterSec when 429 is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '30' : null) },
        json: () => Promise.resolve({}),
      }),
    )
    const result = await secEdgarRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      retryAfterSec?: number
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('rate_limited')
    expect(payload.provider).toBe('sec_edgar')
    expect(payload.retryAfterSec).toBe(30)
    expect(payload.rawSignalQueueId).toBe('q-sec-1')
  })

  it('writes timeout error row when fetch aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    const result = await secEdgarRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      timeoutMs: number
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('timeout')
    expect(payload.provider).toBe('sec_edgar')
    expect(payload.timeoutMs).toBe(20_000)
    expect(payload.rawSignalQueueId).toBe('q-sec-1')
  })

  it('writes external_api_error with statusCode when EDGAR returns 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      }),
    )
    const result = await secEdgarRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
      statusCode: number
    }
    expect(payload.errorType).toBe('external_api_error')
    expect(payload.provider).toBe('sec_edgar')
    expect(payload.statusCode).toBe(503)
  })

  it('writes parse_error when EDGAR returns 200 with unexpected JSON shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ unexpected: 'shape' }),
      }),
    )
    const result = await secEdgarRunner(makeCtx())
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      provider: string
    }
    expect(payload.errorType).toBe('parse_error')
    expect(payload.provider).toBe('sec_edgar')
  })

  it('writes resolution_failed error row when entity list is empty / all tokens too short', async () => {
    // Entity list is degenerate (single char or lowercase-led); the
    // adapter's filter (e.length >= 2 && starts-with capital) rejects
    // all entries so no full-text keywords can be formed.
    const result = await secEdgarRunner(
      makeCtx({ entities: ['a', 'x', ''] }),
    )
    expect(result!.confidenceLevel).toBe('unavailable')
    const payload = result!.rawContent as {
      errorType: string
      attemptedKey: string
      rawSignalQueueId?: string
    }
    expect(payload.errorType).toBe('resolution_failed')
    expect(typeof payload.attemptedKey).toBe('string')
    expect(payload.rawSignalQueueId).toBe('q-sec-1')
  })

  it('raises divergenceFlag with ≥3 Form 4 filings in the 30-day pre-window', async () => {
    // Use count-threshold rather than transactionValueUsd (scope note: Form
    // 4 XML deep-parse is a follow-up task, so adapter has no dollar
    // volume field to check against).
    const hits = [
      {
        form: '4',
        adsh: '0001234567-26-000010',
        file_date: daysBefore(TODAY, 5),
        display_names: ['Insider One (CIK 0000111)'],
        ciks: ['0000000111'],
        tickers: ['ACME'],
      },
      {
        form: '4',
        adsh: '0001234567-26-000011',
        file_date: daysBefore(TODAY, 12),
        display_names: ['Insider Two (CIK 0000222)'],
        ciks: ['0000000222'],
        tickers: ['ACME'],
      },
      {
        form: '4',
        adsh: '0001234567-26-000012',
        file_date: daysBefore(TODAY, 20),
        display_names: ['Insider Three (CIK 0000333)'],
        ciks: ['0000000333'],
        tickers: ['ACME'],
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(edgarSearchResponse(hits)),
      }),
    )
    vi.spyOn(anthropic, 'callClaude').mockResolvedValue({
      text: JSON.stringify({
        filingsRelevant: 3,
        materialFilings: 0,
        addsMissingContext: false,
        gapDescription: '',
      }),
      costUsd: 0.001,
      model: anthropic.HAIKU,
      usage: { input_tokens: 100, output_tokens: 50 },
    } as never)

    const result = await secEdgarRunner(makeCtx())
    expect(result!.divergenceFlag).toBe(true)
    expect(result!.divergenceDescription).toBeTruthy()
    expect(result!.divergenceDescription!.toLowerCase()).toContain('insider')
  })

  it('does not silently drop 2- and 3-character tickers from the search query', async () => {
    // entities include classic short-ticker mega-caps that the old > 3
    // filter would have dropped (IBM, GE, F, T, KO, GM, CME, AMC …).
    // These are the highest-signal Form 4 cohort, so the filter must
    // admit them.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () =>
        Promise.resolve(
          edgarSearchResponse([
            {
              form: '4',
              adsh: '0001234567-26-000001',
              file_date: daysBefore(TODAY, 5),
              display_names: ['INTERNATIONAL BUSINESS MACHINES CORP (CIK 0000051143)'],
              ciks: ['0000051143'],
              tickers: ['IBM'],
            },
          ]),
        ),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(anthropic, 'callClaude').mockResolvedValue({
      text: JSON.stringify({
        filingsRelevant: 1,
        materialFilings: 0,
        addsMissingContext: false,
        gapDescription: '',
      }),
      costUsd: 0.001,
      model: anthropic.HAIKU,
      usage: { input_tokens: 100, output_tokens: 50 },
    } as never)

    const result = await secEdgarRunner(
      makeCtx({ entities: ['IBM', 'GE', 'F', 'T'] }),
    )

    // Must not have been short-circuited to resolution_failed.
    expect(result!.confidenceLevel).not.toBe('unavailable')
    const rawContent = result!.rawContent as {
      form4Trades?: unknown[]
      errorType?: string
    }
    expect(rawContent.errorType).toBeUndefined()
    expect(rawContent.form4Trades).toBeDefined()

    // Confirm the URL passed to fetch contained at least one of the
    // short tickers in the q param.
    const urlsCalled = fetchMock.mock.calls.map((c) => c[0] as string)
    const someUrlHasShortTicker = urlsCalled.some(
      (u) => u.includes('IBM') || u.includes('GE') || u.includes('F') || u.includes('T'),
    )
    expect(someUrlHasShortTicker).toBe(true)
  })
})
