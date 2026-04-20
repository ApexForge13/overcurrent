import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { polygonRunner } from '@/lib/raw-signals/integrations/polygon'
import type { RunnerContext } from '@/lib/raw-signals/runner'

const baseCtx: RunnerContext = {
  queueId: 'q1',
  storyClusterId: 'cluster1',
  umbrellaArcId: null,
  signalType: 'financial_equity',
  triggerLayer: 'category_trigger',
  triggerReason: 'always_on_financial',
  approvedByAdmin: false,
  cluster: {
    id: 'cluster1',
    headline: 'Test cluster',
    synopsis: 'Test synopsis',
    firstDetectedAt: new Date('2026-04-15T12:00:00Z'),
    entities: ['Apple Inc'],
    signalCategory: 'corporate_scandal',
  },
}

describe('polygonRunner', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.POLYGON_API_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.POLYGON_API_KEY
    else process.env.POLYGON_API_KEY = originalKey
    vi.restoreAllMocks()
  })

  it('writes unavailable row when POLYGON_API_KEY is absent', async () => {
    delete process.env.POLYGON_API_KEY
    const result = await polygonRunner(baseCtx)
    expect(result).not.toBeNull()
    expect(result!.signalSource).toBe('polygon')
    expect(result!.confidenceLevel).toBe('unavailable')
    expect(result!.divergenceFlag).toBe(false)
    expect(result!.haikuSummary).toMatch(/Polygon.*not.*provisioned/i)
  })
})
