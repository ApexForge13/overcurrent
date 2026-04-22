import { describe, it, expect } from 'vitest'
import {
  parseConsensusRow,
  parseNumberWithUnit,
  normalizeDate,
} from '@/lib/macro/consensus/investing-calendar'

describe('investing.com consensus scraper parsers', () => {
  it('parseNumberWithUnit handles K/M/B/% units and negatives', () => {
    expect(parseNumberWithUnit('275K')).toEqual({ value: 275, unit: 'K' })
    expect(parseNumberWithUnit('4.5%')).toEqual({ value: 4.5, unit: '%' })
    expect(parseNumberWithUnit('2.3B')).toEqual({ value: 2.3, unit: 'B' })
    expect(parseNumberWithUnit('-0.1')).toEqual({ value: -0.1, unit: null })
    expect(parseNumberWithUnit('')).toEqual({ value: null, unit: null })
    expect(parseNumberWithUnit('-')).toEqual({ value: null, unit: null })
    expect(parseNumberWithUnit('N/A')).toEqual({ value: null, unit: null })
  })

  it('normalizeDate converts "Apr 18, 2026" to ISO YYYY-MM-DD', () => {
    expect(normalizeDate('Apr 18, 2026')).toBe('2026-04-18')
    expect(normalizeDate('Apr 18, 2026 (Fri)')).toBe('2026-04-18')
    expect(normalizeDate('not a date')).toBeNull()
    expect(normalizeDate('')).toBeNull()
  })

  it('parseConsensusRow picks the most recent row when no date supplied', () => {
    const html = `
      <table>
        <tr><th>Date</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr>
        <tr><td>Apr 18, 2026</td><td>275K</td><td>240K</td><td>220K</td></tr>
        <tr><td>Mar 21, 2026</td><td>220K</td><td>230K</td><td>210K</td></tr>
      </table>
    `
    const parsed = parseConsensusRow(html)
    expect(parsed).not.toBeNull()
    expect(parsed?.date).toBe('2026-04-18')
    expect(parsed?.actual).toBe(275)
    expect(parsed?.consensus).toBe(240)
    expect(parsed?.unit).toBe('K')
  })

  it('parseConsensusRow picks the row matching supplied isoDate', () => {
    const html = `
      <table>
        <tr><td>Apr 18, 2026</td><td>275K</td><td>240K</td><td>220K</td></tr>
        <tr><td>Mar 21, 2026</td><td>220K</td><td>230K</td><td>210K</td></tr>
      </table>
    `
    const parsed = parseConsensusRow(html, '2026-03-21')
    expect(parsed?.date).toBe('2026-03-21')
    expect(parsed?.actual).toBe(220)
    expect(parsed?.consensus).toBe(230)
  })

  it('parseConsensusRow returns null when no table rows match pattern', () => {
    const html = '<html><body>No table here</body></html>'
    expect(parseConsensusRow(html)).toBeNull()
  })

  it('parseConsensusRow handles missing consensus (dash)', () => {
    const html = `
      <tr><td>Apr 18, 2026</td><td>275K</td><td>-</td><td>220K</td></tr>
    `
    const parsed = parseConsensusRow(html)
    expect(parsed?.consensus).toBeNull()
    expect(parsed?.actual).toBe(275)
  })
})
