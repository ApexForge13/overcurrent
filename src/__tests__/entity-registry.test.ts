import { describe, expect, it } from 'vitest'
import { loadEntityRegistry } from '@/lib/entities/registry'

describe('loadEntityRegistry', () => {
  it('loads futures + ETFs synchronously when external sources are disabled', async () => {
    const result = await loadEntityRegistry({ sec: false, coingecko: false })
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.bySource.sec).toBe(0)
    expect(result.bySource.coingecko).toBe(0)
    expect(result.bySource.futures).toBeGreaterThan(0)
    expect(result.bySource.etfs).toBeGreaterThan(0)
  })

  it('tolerates a failing external source (SEC down) without aborting the rest', async () => {
    const fetchImpl = () =>
      Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' } as Response)
    const events: string[] = []
    const result = await loadEntityRegistry({
      sec: { fetchImpl },
      coingecko: false,
      onProgress: (e) => {
        if (e.status === 'failed' || e.status === 'success') events.push(`${e.source}:${e.status}`)
      },
    })
    // SEC should fail; futures + ETFs should succeed
    expect(events).toContain('sec:failed')
    expect(events).toContain('futures:success')
    expect(events).toContain('etfs:success')
    expect(result.entities.length).toBeGreaterThan(0)
  })

  it('ETFs override SEC entries for shared tickers (SPY category=etf)', async () => {
    // Stub SEC to return SPY classified as equity; ETFs will reclassify.
    const fetchImpl = async () =>
      ({
        ok: true,
        json: async () => ({ '0': { cik_str: 1, ticker: 'SPY', title: 'S&P 500 Index Trust' } }),
      }) as Response
    const result = await loadEntityRegistry({
      sec: { fetchImpl },
      coingecko: false,
    })
    const spy = result.entities.find((e) => e.identifier === 'SPY')
    expect(spy?.category).toBe('etf')
    expect(result.duplicatesOverridden).toBeGreaterThan(0)
  })
})
