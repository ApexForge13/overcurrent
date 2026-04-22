import { describe, it, expect } from 'vitest'
import {
  parseAmountBucket,
  extractTicker,
  classifyTransactionType,
  parseHouseIndexHtml,
} from '@/lib/raw-signals/integrations/congress-trade'

describe('congress-trade adapter parsers', () => {
  it('parseAmountBucket handles all standard Congress ranges', () => {
    expect(parseAmountBucket('$1,001 - $15,000')).toEqual({ low: 1001, high: 15000, raw: '$1,001 - $15,000' })
    expect(parseAmountBucket('$15,001 - $50,000')).toEqual({ low: 15001, high: 50000, raw: '$15,001 - $50,000' })
    expect(parseAmountBucket('$50,001 - $100,000')).toEqual({ low: 50001, high: 100000, raw: '$50,001 - $100,000' })
    expect(parseAmountBucket('$100,001 - $250,000')).toEqual({ low: 100001, high: 250000, raw: '$100,001 - $250,000' })
    expect(parseAmountBucket('$500,001 - $1,000,000')).toEqual({ low: 500001, high: 1_000_000, raw: '$500,001 - $1,000,000' })
  })

  it('parseAmountBucket handles open-ended "+" buckets', () => {
    const parsed = parseAmountBucket('$50,000,000 +')
    expect(parsed?.low).toBe(50_000_000)
    expect(parsed?.high).toBe(50_000_000 * 5)
  })

  it('parseAmountBucket returns null for garbage input', () => {
    expect(parseAmountBucket('')).toBeNull()
    expect(parseAmountBucket('N/A')).toBeNull()
    expect(parseAmountBucket('$abc')).toBeNull()
  })

  it('extractTicker picks up parenthesized and leading tickers', () => {
    expect(extractTicker('Apple Inc. (AAPL) - Common Stock')).toBe('AAPL')
    expect(extractTicker('Alphabet Inc. Class A (GOOGL)')).toBe('GOOGL')
    expect(extractTicker('BRK.B Class B Share (BRK.B)')).toBe('BRK.B')
    expect(extractTicker('TSLA Common Stock')).toBe('TSLA')
    expect(extractTicker('Treasury Bond (non-ticker)')).toBeNull()
    expect(extractTicker('')).toBeNull()
  })

  it('classifyTransactionType normalizes House codes and Senate words', () => {
    expect(classifyTransactionType('P')).toBe('purchase')
    expect(classifyTransactionType('Purchase')).toBe('purchase')
    expect(classifyTransactionType('S')).toBe('sale')
    expect(classifyTransactionType('Sale (Partial)')).toBe('sale')
    expect(classifyTransactionType('E')).toBe('exchange')
    expect(classifyTransactionType('Exchange')).toBe('exchange')
    expect(classifyTransactionType('gift')).toBe('other')
  })

  it('parseHouseIndexHtml extracts filings from Apache listing HTML', () => {
    const html = `<html><body><pre>
<a href="Pelosi_10001.pdf">Pelosi_10001.pdf</a>  2026-04-18 09:30
<a href="Swalwell_10002.pdf">Swalwell_10002.pdf</a>  2026-04-19 14:15
</pre></body></html>`
    const rows = parseHouseIndexHtml(html)
    expect(rows).toHaveLength(2)
    expect(rows[0].url).toContain('Pelosi_10001.pdf')
    expect(rows[0].disclosedAt).toBe('2026-04-18T09:30Z')
    expect(rows[1].disclosedAt).toBe('2026-04-19T14:15Z')
  })
})
