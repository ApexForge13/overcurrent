import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  searchByEntity,
  pollRecentFilings,
  bucketHits,
  accessionToUrl,
  cleanFilerName,
  type SecFilingHit,
} from '@/lib/raw-signals/clients/sec-edgar-client'

/** Helper — build a single EDGAR full-text search hit payload as the API returns it. */
function makeRawHit(partial: {
  form: string
  adsh: string
  file_date: string
  display_names?: string[]
  ciks?: string[]
  tickers?: string[]
}): { _source: Record<string, unknown> } {
  return {
    _source: {
      form: partial.form,
      adsh: partial.adsh,
      file_date: partial.file_date,
      display_names: partial.display_names ?? [`${partial.form} Filer Inc (CIK 0000000123) (Filer)`],
      ciks: partial.ciks ?? ['0000000123'],
      tickers: partial.tickers ?? [],
    },
  }
}

function mockFetchJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const headersObj = {
    get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null,
  }
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: async () => body,
  })
}

describe('sec-edgar-client', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    process.env.SEC_EDGAR_USER_AGENT = 'Overcurrent/test test@example.com'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('searchByEntity returns parsed hits on a 200 with hits array', async () => {
    globalThis.fetch = mockFetchJson({
      hits: {
        hits: [
          makeRawHit({ form: '4', adsh: '0001234567-26-000001', file_date: '2026-04-01' }),
          makeRawHit({ form: '8-K', adsh: '0001234567-26-000002', file_date: '2026-04-10' }),
        ],
      },
    })
    const outcome = await searchByEntity({
      entities: ['Acme Corporation'],
      since: new Date('2026-04-15T00:00:00Z'),
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error()
    expect(outcome.hits).toHaveLength(2)
    expect(outcome.hits[0].formType).toBe('4')
    expect(outcome.hits[0].accessionNumber).toBe('0001234567-26-000001')
  })

  it('searchByEntity caps results at maxHits', async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      makeRawHit({ form: '4', adsh: `0001234567-26-${String(i).padStart(6, '0')}`, file_date: '2026-04-01' }),
    )
    globalThis.fetch = mockFetchJson({ hits: { hits: many } })
    const outcome = await searchByEntity({
      entities: ['Acme'],
      since: new Date('2026-04-15T00:00:00Z'),
      maxHits: 10,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error()
    expect(outcome.hits).toHaveLength(10)
  })

  it('routes 403 responses to auth_failed', async () => {
    globalThis.fetch = mockFetchJson({}, 403)
    const outcome = await searchByEntity({
      entities: ['Acme'],
      since: new Date('2026-04-15T00:00:00Z'),
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error()
    expect(outcome.errorType).toBe('auth_failed')
  })

  it('routes 429 responses to rate_limited with retryAfterSec', async () => {
    globalThis.fetch = mockFetchJson({}, 429, { 'retry-after': '42' })
    const outcome = await searchByEntity({
      entities: ['Acme'],
      since: new Date('2026-04-15T00:00:00Z'),
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error()
    expect(outcome.errorType).toBe('rate_limited')
    if (outcome.errorType !== 'rate_limited') throw new Error()
    expect(outcome.retryAfterSec).toBe(42)
  })

  it('routes malformed response body to parse_error', async () => {
    // hits is present but not { hits: [] } — i.e., missing nested array
    globalThis.fetch = mockFetchJson({ hits: { total: 5 } })
    const outcome = await searchByEntity({
      entities: ['Acme'],
      since: new Date('2026-04-15T00:00:00Z'),
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error()
    expect(outcome.errorType).toBe('parse_error')
  })

  it('pollRecentFilings advances forward — returns hits sorted by filedAt ascending for caller-side cursor math', async () => {
    // Return results in reverse-chronological order (the EDGAR default)
    globalThis.fetch = mockFetchJson({
      hits: {
        hits: [
          makeRawHit({ form: '4', adsh: 'a3', file_date: '2026-04-10' }),
          makeRawHit({ form: '4', adsh: 'a2', file_date: '2026-04-05' }),
          makeRawHit({ form: '4', adsh: 'a1', file_date: '2026-04-01' }),
        ],
      },
    })
    const outcome = await pollRecentFilings({
      forms: ['4'],
      sinceCursor: '2026-03-25',
      until: new Date('2026-04-15T00:00:00Z'),
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error()
    // Sorted ascending so caller can take the max trivially
    expect(outcome.hits.map((h) => h.filedAt)).toEqual(['2026-04-01', '2026-04-05', '2026-04-10'])
  })

  it('pollRecentFilings rejects invalid sinceCursor with parse_error', async () => {
    globalThis.fetch = mockFetchJson({ hits: { hits: [] } })
    const outcome = await pollRecentFilings({
      forms: ['4'],
      sinceCursor: 'not-a-date',
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error()
    expect(outcome.errorType).toBe('parse_error')
  })

  it('bucketHits separates hits into form4/13F/13D buckets and drops 8-K', () => {
    const hits: SecFilingHit[] = [
      {
        accessionNumber: 'a1',
        filedAt: '2026-04-01',
        formType: '4',
        displayNames: ['Acme Corp (CIK 0000000123) (Filer)'],
        ciks: ['0000000123'],
        tickers: ['ACME'],
      },
      {
        accessionNumber: 'a2',
        filedAt: '2026-04-02',
        formType: '13F-HR',
        displayNames: ['Hedge Fund LP (CIK 0000000456) (Filer)'],
        ciks: ['0000000456'],
        tickers: [],
        periodOfReport: '2026-03-31',
      },
      {
        accessionNumber: 'a3',
        filedAt: '2026-04-03',
        formType: 'SC 13D',
        displayNames: ['Activist Ventures (CIK 0000000789) (Filer)'],
        ciks: ['0000000789'],
        tickers: ['TARG'],
      },
      {
        accessionNumber: 'a4',
        filedAt: '2026-04-04',
        formType: '8-K',
        displayNames: ['Random Corp'],
        ciks: [],
        tickers: [],
      },
    ]
    const { form4Trades, f13Holdings, d13Filings } = bucketHits(hits)
    expect(form4Trades).toHaveLength(1)
    expect(form4Trades[0].ticker).toBe('ACME')
    expect(f13Holdings).toHaveLength(1)
    expect(f13Holdings[0].reportDate).toBe('2026-03-31')
    expect(d13Filings).toHaveLength(1)
    expect(d13Filings[0].ticker).toBe('TARG')
  })

  it('accessionToUrl + cleanFilerName shape public URLs and strip EDGAR suffixes', () => {
    expect(accessionToUrl('0001234567-26-000001', '0000000123')).toContain(
      '/Archives/edgar/data/123/000123456726000001/0001234567-26-000001-index.htm',
    )
    expect(cleanFilerName('Acme Corp (CIK 0000000123) (Filer)')).toBe('Acme Corp')
    expect(cleanFilerName('NoSuffix Inc')).toBe('NoSuffix Inc')
  })
})
