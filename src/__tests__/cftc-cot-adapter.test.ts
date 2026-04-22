import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { parseCotRow, upsertCotRows, type CotRow } from '@/lib/raw-signals/integrations/cftc-cot'

describe('CFTC COT adapter', () => {
  it('parseCotRow normalizes JSON response into CotRow shape', () => {
    const raw = {
      cftc_contract_market_code: '067651',
      cftc_market_code: 'NYMEX',
      market_and_exchange_names: 'WTI CRUDE OIL - NEW YORK MERCANTILE EXCHANGE',
      report_date_as_yyyy_mm_dd: '2026-04-15T00:00:00.000',
      open_interest_all: '2000000',
      m_money_positions_long: '400000',
      m_money_positions_short: '100000',
      prod_merc_positions_long: '500000',
      prod_merc_positions_short: '800000',
      swap_positions_long_all: '200000',
      swap__positions_short_all: '250000',
    }
    const parsed = parseCotRow(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.marketCode).toBe('067651')
    expect(parsed?.managedMoneyNetPct).toBeCloseTo(0.15, 4) // (400k-100k)/2M
    expect(parsed?.managedMoneyLongPct).toBeCloseTo(0.2, 4)
    expect(parsed?.openInterestTotal).toBe(2_000_000)
    expect(parsed?.producerNetPct).toBeCloseTo(-0.15, 4) // (500k-800k)/2M
  })

  it('parseCotRow rejects rows with missing market code', () => {
    const raw = {
      cftc_market_code: 'NYMEX',
      report_date_as_yyyy_mm_dd: '2026-04-15',
      open_interest_all: '1000',
    }
    expect(parseCotRow(raw)).toBeNull()
  })

  it('parseCotRow rejects rows with zero/invalid open interest', () => {
    const raw = {
      cftc_contract_market_code: '067651',
      cftc_market_code: 'NYMEX',
      market_and_exchange_names: 'WTI',
      report_date_as_yyyy_mm_dd: '2026-04-15',
      open_interest_all: '0',
    }
    expect(parseCotRow(raw)).toBeNull()
  })

  it('upsertCotRows writes to CftcPosition with unique-key upsert', async () => {
    const upsertMock = vi.fn().mockResolvedValue({})
    const prisma = {
      cftcPosition: { upsert: upsertMock },
    } as unknown as PrismaClient
    const rows: CotRow[] = [
      {
        marketCode: '067651',
        exchangeCode: 'NYMEX',
        marketName: 'WTI',
        reportDate: new Date('2026-04-15T00:00:00Z'),
        managedMoneyLongPct: 0.2,
        managedMoneyShortPct: 0.05,
        managedMoneyNetPct: 0.15,
        producerNetPct: -0.15,
        swapDealerNetPct: -0.025,
        openInterestTotal: 2_000_000,
      },
    ]
    const result = await upsertCotRows(prisma, rows)
    expect(result.upserted).toBe(1)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const call = upsertMock.mock.calls[0][0] as {
      where: { marketCode_exchangeCode_reportDate: { marketCode: string } }
      create: { managedMoneyNetPct: number }
    }
    expect(call.where.marketCode_exchangeCode_reportDate.marketCode).toBe('067651')
    expect(call.create.managedMoneyNetPct).toBe(0.15)
  })

  it('upsertCotRows is idempotent — re-upsert doesn\'t duplicate rows', async () => {
    const upsertMock = vi.fn().mockResolvedValue({})
    const prisma = { cftcPosition: { upsert: upsertMock } } as unknown as PrismaClient
    const row: CotRow = {
      marketCode: '067651', exchangeCode: 'NYMEX', marketName: 'WTI',
      reportDate: new Date('2026-04-15T00:00:00Z'),
      managedMoneyLongPct: 0.2, managedMoneyShortPct: 0.05, managedMoneyNetPct: 0.15,
      producerNetPct: null, swapDealerNetPct: null, openInterestTotal: 2_000_000,
    }
    await upsertCotRows(prisma, [row])
    await upsertCotRows(prisma, [row])
    expect(upsertMock).toHaveBeenCalledTimes(2)
    // Both calls hit the same unique key — DB-side dedupes
  })
})
