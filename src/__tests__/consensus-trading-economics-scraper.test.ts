import { describe, it, expect } from 'vitest'
import { parseTERow } from '@/lib/macro/consensus/trading-economics-calendar'

describe('Trading Economics consensus scraper', () => {
  it('parseTERow finds the row matching the indicator slug key and pulls columns', () => {
    const html = `
      <table>
        <tr>
          <td>Apr 18, 2026</td>
          <td>08:30</td>
          <td>US</td>
          <td>Non Farm Payrolls</td>
          <td>275K</td>
          <td>220K</td>
          <td>240K</td>
        </tr>
      </table>
    `
    const parsed = parseTERow(html, 'non-farm-payrolls')
    expect(parsed).not.toBeNull()
    expect(parsed?.date).toBe('2026-04-18')
    expect(parsed?.consensus).toBe(240) // last column (forecast-ish)
    expect(parsed?.actual).toBe(275) // third-from-last
  })

  it('returns null when no row matches the slug-key substring', () => {
    const html = `
      <tr>
        <td>Apr 18, 2026</td><td>08:30</td><td>JP</td>
        <td>Tokyo CPI</td><td>1.2%</td><td>1.0%</td><td>1.1%</td>
      </tr>
    `
    expect(parseTERow(html, 'non-farm-payrolls')).toBeNull()
  })

  it('skips rows with fewer than 5 columns', () => {
    const html = `
      <tr><td>Non Farm Payrolls</td><td>275K</td></tr>
      <tr>
        <td>Apr 18, 2026</td><td>08:30</td><td>US</td>
        <td>Non Farm Payrolls</td><td>275K</td><td>220K</td><td>240K</td>
      </tr>
    `
    const parsed = parseTERow(html, 'non-farm-payrolls')
    expect(parsed?.consensus).toBe(240)
  })

  it('returns null for empty html', () => {
    expect(parseTERow('', 'anything')).toBeNull()
  })
})
