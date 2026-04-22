import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchRecentTranscripts,
  fetchTranscript,
  parseTranscriptRef,
  normalizeIsoDate,
} from '@/lib/raw-signals/clients/dcf-client'

function mockFetchJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const headersObj = { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null }
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: async () => body,
  })
}

describe('DCF client', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parseTranscriptRef normalizes DCF fields', () => {
    const ref = parseTranscriptRef({
      symbol: 'aapl',
      quarter: 2,
      year: 2026,
      date: '2026-04-20',
    })
    expect(ref).not.toBeNull()
    expect(ref?.ticker).toBe('AAPL')
    expect(ref?.quarter).toBe(2)
    expect(ref?.year).toBe(2026)
    expect(ref?.reportDate).toBe('2026-04-20')
  })

  it('parseTranscriptRef rejects missing fields', () => {
    expect(parseTranscriptRef({ symbol: 'AAPL', quarter: 2, year: 2026 })).toBeNull() // no date
    expect(parseTranscriptRef({ quarter: 2, year: 2026, date: '2026-04-20' })).toBeNull() // no symbol
  })

  it('normalizeIsoDate handles valid + invalid', () => {
    expect(normalizeIsoDate('2026-04-20')).toBe('2026-04-20')
    expect(normalizeIsoDate('April 20, 2026')).toBe('2026-04-20')
    expect(normalizeIsoDate('garbage')).toBeNull()
    expect(normalizeIsoDate('')).toBeNull()
  })

  it('fetchRecentTranscripts returns array of refs', async () => {
    globalThis.fetch = mockFetchJson([
      { symbol: 'AAPL', quarter: 2, year: 2026, date: '2026-04-20' },
      { symbol: 'TSLA', quarter: 2, year: 2026, date: '2026-04-22' },
      { symbol: '', quarter: 2, year: 2026, date: '2026-04-22' }, // missing symbol, dropped
    ])
    const out = await fetchRecentTranscripts('test-key')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value).toHaveLength(2)
    expect(out.value[0].ticker).toBe('AAPL')
  })

  it('fetchTranscript extracts content from first array element', async () => {
    globalThis.fetch = mockFetchJson([
      {
        symbol: 'AAPL',
        quarter: 2,
        year: 2026,
        date: '2026-04-20',
        content: 'Our quarterly results demonstrate strong momentum...',
      },
    ])
    const out = await fetchTranscript('AAPL', 'test-key')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value.content).toContain('strong momentum')
  })

  it('401 routes to auth_failed', async () => {
    globalThis.fetch = mockFetchJson({}, 401)
    const out = await fetchRecentTranscripts('bad-key')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('auth_failed')
  })

  it('429 routes to rate_limited with retryAfterSec', async () => {
    globalThis.fetch = mockFetchJson({}, 429, { 'retry-after': '60' })
    const out = await fetchRecentTranscripts('test-key')
    expect(out.ok).toBe(false)
    if (out.ok || out.errorType !== 'rate_limited') throw new Error()
    expect(out.retryAfterSec).toBe(60)
  })

  it('non-array response routes to parse_error', async () => {
    globalThis.fetch = mockFetchJson({ transcripts: [] }) // not an array
    const out = await fetchRecentTranscripts('test-key')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('parse_error')
  })
})
