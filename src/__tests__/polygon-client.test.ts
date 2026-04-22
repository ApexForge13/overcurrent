import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchPreviousDayBar,
  fetchDailyBars,
  fetchSnapshot,
  fetchOptionsChain,
} from '@/lib/raw-signals/clients/polygon-client'

function mockFetchJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const headersObj = { get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null }
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: async () => body,
  })
}

describe('polygon-client', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {})
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('fetchPreviousDayBar parses {open,high,low,close,volume,ts}', async () => {
    globalThis.fetch = mockFetchJson({ results: [{ o: 100, h: 105, l: 99, c: 103, v: 5_000_000, t: 1713_000_000_000 }] })
    const out = await fetchPreviousDayBar('AAPL', 'test-key')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value.close).toBe(103)
    expect(out.value.volume).toBe(5_000_000)
  })

  it('fetchDailyBars returns array of bars', async () => {
    globalThis.fetch = mockFetchJson({
      results: [
        { o: 100, h: 102, l: 99, c: 101, v: 1000, t: 1 },
        { o: 101, h: 105, l: 100, c: 104, v: 2000, t: 2 },
      ],
    })
    const out = await fetchDailyBars('AAPL', '2026-04-01', '2026-04-02', 'test-key')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value).toHaveLength(2)
    expect(out.value[1].close).toBe(104)
  })

  it('fetchSnapshot extracts lastPrice + prevClose + dayOpen', async () => {
    globalThis.fetch = mockFetchJson({
      ticker: {
        ticker: 'AAPL',
        lastTrade: { p: 175.50 },
        prevDay: { c: 172.00 },
        day: { o: 173.00 },
        todaysChangePerc: 2.03,
        updated: 1713_123_000_000_000,
      },
    })
    const out = await fetchSnapshot('AAPL', 'test-key')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value.lastPrice).toBe(175.50)
    expect(out.value.prevClose).toBe(172.00)
    expect(out.value.dayOpen).toBe(173.00)
  })

  it('401/403 routes to auth_failed', async () => {
    globalThis.fetch = mockFetchJson({}, 401)
    const out = await fetchSnapshot('AAPL', 'bad-key')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('auth_failed')
  })

  it('429 routes to rate_limited with retryAfterSec', async () => {
    globalThis.fetch = mockFetchJson({}, 429, { 'retry-after': '30' })
    const out = await fetchSnapshot('AAPL', 'test-key')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('rate_limited')
    if (out.errorType !== 'rate_limited') throw new Error()
    expect(out.retryAfterSec).toBe(30)
  })

  it('5xx routes to server_error with statusCode', async () => {
    globalThis.fetch = mockFetchJson({}, 503)
    const out = await fetchSnapshot('AAPL', 'test-key')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('server_error')
  })

  it('fetchOptionsChain normalizes contracts with type + volume + OI', async () => {
    globalThis.fetch = mockFetchJson({
      results: [
        {
          details: { contract_type: 'call', expiration_date: '2026-05-15', strike_price: 180, ticker: 'O:AAPL260515C00180000' },
          day: { volume: 5000, close: 2.50 },
          open_interest: 1000,
          implied_volatility: 0.35,
        },
        {
          details: { contract_type: 'put', expiration_date: '2026-05-15', strike_price: 170, ticker: 'O:AAPL260515P00170000' },
          day: { volume: 3000, close: 1.20 },
          open_interest: 800,
          implied_volatility: 0.32,
        },
      ],
    })
    const out = await fetchOptionsChain('AAPL', 'test-key')
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error()
    expect(out.value).toHaveLength(2)
    expect(out.value[0].type).toBe('call')
    expect(out.value[0].dayVolume).toBe(5000)
    expect(out.value[0].openInterest).toBe(1000)
    expect(out.value[1].type).toBe('put')
  })

  it('missing results in response routes to parse_error', async () => {
    globalThis.fetch = mockFetchJson({ status: 'OK' }) // no results field
    const out = await fetchPreviousDayBar('AAPL', 'test-key')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error()
    expect(out.errorType).toBe('parse_error')
  })
})
