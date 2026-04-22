import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TriggerContext } from '@/lib/gap-score/triggers/types'

vi.mock('@/lib/raw-signals/clients/dcf-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/raw-signals/clients/dcf-client')
  >('@/lib/raw-signals/clients/dcf-client')
  return { ...actual, fetchRecentTranscripts: vi.fn(), fetchTranscript: vi.fn() }
})

import { earningsTranscriptTrigger } from '@/lib/gap-score/triggers/ground-truth/earnings-transcript'
import { fetchRecentTranscripts, fetchTranscript } from '@/lib/raw-signals/clients/dcf-client'

const recentMock = vi.mocked(fetchRecentTranscripts)
const transcriptMock = vi.mocked(fetchTranscript)

function ctx(opts: {
  refs?: Array<{ ticker: string; quarter: number; year: number; reportDate: string }>
  transcriptContent?: string
  entities?: Array<{ id: string; identifier: string }>
  existingFire?: boolean
  cursor?: string
}): TriggerContext {
  return {
    now: new Date('2026-04-22T12:00:00Z'),
    prisma: {
      trackedEntity: { findMany: vi.fn().mockResolvedValue(opts.entities ?? []) },
      triggerEvent: {
        findFirst: vi.fn().mockResolvedValue(opts.existingFire ? { id: 'ex1' } : null),
      },
      triggerCursor: {
        findUnique: vi.fn().mockResolvedValue(opts.cursor ? { cursorValue: opts.cursor } : null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      earningsSchedule: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      costLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as TriggerContext['prisma'],
  }
}

describe('T-GT11 earnings transcript', () => {
  beforeEach(() => {
    recentMock.mockReset()
    transcriptMock.mockReset()
    process.env.DCF_API_KEY = 'test-key'
  })
  afterEach(() => {
    delete process.env.DCF_API_KEY
  })

  it('writes missing-key heartbeat + skips when DCF_API_KEY absent', async () => {
    delete process.env.DCF_API_KEY
    const c = ctx({})
    const fires = await earningsTranscriptTrigger(c)
    expect(fires).toEqual([])
    expect(c.prisma.costLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalled()
  })

  it('fires severity 0.7 with transcript preview + URL', async () => {
    recentMock.mockResolvedValueOnce({
      ok: true,
      value: [{ ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20' }],
    })
    transcriptMock.mockResolvedValueOnce({
      ok: true,
      value: {
        ticker: 'AAPL',
        quarter: 2,
        year: 2026,
        reportDate: '2026-04-20',
        content: 'Strong quarter. Revenue growth of 12%.',
      },
    })
    const fires = await earningsTranscriptTrigger(
      ctx({
        refs: [{ ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20' }],
        entities: [{ id: 'e-aapl', identifier: 'AAPL' }],
      }),
    )
    expect(fires).toHaveLength(1)
    expect(fires[0].severity).toBe(0.7)
    expect(fires[0].stream).toBe('ground_truth')
    const md = fires[0].metadata as { direction: number; transcript_preview: string; transcript_url: string; report_date: string }
    expect(md.direction).toBe(0)
    expect(md.transcript_preview).toContain('Strong quarter')
    expect(md.transcript_url).toContain('AAPL')
    expect(md.report_date).toBe('2026-04-20')
  })

  it('dedupes on existing TriggerEvent for (entity, reportDate)', async () => {
    recentMock.mockResolvedValueOnce({
      ok: true,
      value: [{ ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20' }],
    })
    const fires = await earningsTranscriptTrigger(
      ctx({
        entities: [{ id: 'e-aapl', identifier: 'AAPL' }],
        existingFire: true,
      }),
    )
    expect(fires).toHaveLength(0)
  })

  it('upserts EarningsSchedule for current + next (+90d projected)', async () => {
    recentMock.mockResolvedValueOnce({
      ok: true,
      value: [{ ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20' }],
    })
    transcriptMock.mockResolvedValueOnce({
      ok: true,
      value: { ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20', content: 'Hi' },
    })
    const c = ctx({
      entities: [{ id: 'e-aapl', identifier: 'AAPL' }],
    })
    await earningsTranscriptTrigger(c)
    const upsert = c.prisma.earningsSchedule.upsert as ReturnType<typeof vi.fn>
    // Called twice: confirmed current + projected next
    expect(upsert).toHaveBeenCalledTimes(2)
    const firstCall = upsert.mock.calls[0][0] as { create: { confirmed: boolean; reportDate: Date } }
    expect(firstCall.create.confirmed).toBe(true)
    const secondCall = upsert.mock.calls[1][0] as { create: { confirmed: boolean; reportDate: Date } }
    expect(secondCall.create.confirmed).toBe(false)
    // Next projected should be 90 days after 2026-04-20 = 2026-07-19
    const next = secondCall.create.reportDate.toISOString().split('T')[0]
    expect(next).toBe('2026-07-19')
  })

  it('advances cursor to max reportDate seen', async () => {
    recentMock.mockResolvedValueOnce({
      ok: true,
      value: [
        { ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20' },
        { ticker: 'TSLA', quarter: 2, year: 2026, reportDate: '2026-04-22' },
      ],
    })
    transcriptMock.mockResolvedValue({
      ok: true,
      value: { ticker: 'AAPL', quarter: 2, year: 2026, reportDate: '2026-04-20', content: '' },
    })
    const c = ctx({
      entities: [
        { id: 'e-aapl', identifier: 'AAPL' },
        { id: 'e-tsla', identifier: 'TSLA' },
      ],
    })
    await earningsTranscriptTrigger(c)
    const upsert = c.prisma.triggerCursor.upsert as ReturnType<typeof vi.fn>
    const args = upsert.mock.calls[0][0] as { create: { cursorValue: string } }
    expect(args.create.cursorValue).toBe('2026-04-22')
  })
})
