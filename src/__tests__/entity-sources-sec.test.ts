import { describe, expect, it, vi } from 'vitest'
import { parseSecResponse, loadSecEntities } from '@/lib/entities/sources/sec'

describe('parseSecResponse', () => {
  it('returns [] for empty body', () => {
    expect(parseSecResponse({})).toEqual([])
  })

  it('parses typical SEC response shape', () => {
    const body = {
      '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
      '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' },
    }
    const result = parseSecResponse(body)
    expect(result).toHaveLength(2)
    expect(result[0].identifier).toBe('AAPL')
    expect(result[0].category).toBe('equity')
    expect(result[0].providerIds.cik).toBe('0000320193')
  })

  it('uppercases ticker identifiers', () => {
    const body = { '0': { cik_str: 1, ticker: 'aapl', title: 'Apple Inc.' } }
    const [entity] = parseSecResponse(body)
    expect(entity.identifier).toBe('AAPL')
  })

  it('pads CIK to 10 digits', () => {
    const body = { '0': { cik_str: 42, ticker: 'X', title: 'X Corp' } }
    const [entity] = parseSecResponse(body)
    expect(entity.providerIds.cik).toBe('0000000042')
  })

  it('populates aliases including $TICKER cashtag', () => {
    const body = { '0': { cik_str: 1, ticker: 'AAPL', title: 'Apple Inc.' } }
    const [entity] = parseSecResponse(body)
    expect(entity.entityStrings.aliases).toContain('AAPL')
    expect(entity.entityStrings.aliases).toContain('Apple Inc.')
    expect(entity.entityStrings.aliases).toContain('$AAPL')
  })

  it('skips rows with missing ticker or title', () => {
    const body = {
      '0': { cik_str: 1, ticker: 'A', title: 'Alpha' },
      '1': { cik_str: 2, ticker: '', title: 'Empty Ticker' },
      '2': { cik_str: 3, ticker: 'C', title: '' },
    } as unknown as Parameters<typeof parseSecResponse>[0]
    const result = parseSecResponse(body)
    expect(result).toHaveLength(1)
    expect(result[0].identifier).toBe('A')
  })

  it('assigns equity-relevant ground-truth triggers', () => {
    const body = { '0': { cik_str: 1, ticker: 'AAPL', title: 'Apple' } }
    const [entity] = parseSecResponse(body)
    expect(entity.groundTruthMap.applicableTriggers).toContain('T-GT1')
    expect(entity.groundTruthMap.applicableTriggers).toContain('T-GT5')
    expect(entity.groundTruthMap.applicableTriggers).toContain('T-GT10')
  })
})

describe('loadSecEntities', () => {
  it('sends a descriptive User-Agent (SEC policy)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ '0': { cik_str: 1, ticker: 'A', title: 'Alpha' } }),
    } as Response)
    await loadSecEntities({ fetchImpl })
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    const ua = (init?.headers as Record<string, string>)['User-Agent']
    expect(ua).toMatch(/Overcurrent/)
  })

  it('throws on non-200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response)
    await expect(loadSecEntities({ fetchImpl })).rejects.toThrow(/SEC tickers fetch failed/)
  })
})
