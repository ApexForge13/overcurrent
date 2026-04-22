import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted; const declarations are not. Use vi.hoisted
// to share mock fns between hoisted factories and the test body.
const { requireAdminMock, upsertMock, clearCacheMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  upsertMock: vi.fn().mockResolvedValue({ triggerId: 'T-N1', enabled: true, thresholdOverrides: null }),
  clearCacheMock: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/db', () => ({
  prisma: { triggerEnablement: { upsert: upsertMock } },
}))
vi.mock('@/lib/gap-score/triggers/enablement', () => ({
  clearEnablementCache: clearCacheMock,
}))

import { POST as togglePost } from '@/app/api/admin/triggers/[triggerId]/toggle/route'
import { POST as thresholdsPost } from '@/app/api/admin/triggers/[triggerId]/thresholds/route'

function makeReq(body: unknown): Request {
  return new Request('http://test/anything', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/triggers/[triggerId]/toggle', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
    upsertMock.mockClear()
    clearCacheMock.mockClear()
  })

  it('rejects unauthenticated requests', async () => {
    requireAdminMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const res = await togglePost(makeReq({ enabled: true }), { params: Promise.resolve({ triggerId: 'T-N1' }) })
    expect(res.status).toBe(401)
  })

  it('rejects unknown triggerId with 404', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    const res = await togglePost(makeReq({ enabled: true }), { params: Promise.resolve({ triggerId: 'T-FAKE' }) })
    expect(res.status).toBe(404)
  })

  it('rejects body without enabled boolean', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    const res = await togglePost(makeReq({ enabled: 'yes' }), { params: Promise.resolve({ triggerId: 'T-N1' }) })
    expect(res.status).toBe(400)
  })

  it('upserts + clears cache + returns updated state', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    upsertMock.mockResolvedValueOnce({ triggerId: 'T-N1', enabled: false, thresholdOverrides: null })
    const res = await togglePost(makeReq({ enabled: false }), { params: Promise.resolve({ triggerId: 'T-N1' }) })
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(clearCacheMock).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.enabled).toBe(false)
  })
})

describe('POST /api/admin/triggers/[triggerId]/thresholds', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
    upsertMock.mockClear()
    clearCacheMock.mockClear()
  })

  it('accepts valid threshold map', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    upsertMock.mockResolvedValueOnce({ triggerId: 'T-N1', thresholdOverrides: { z_floor: 2.5 } })
    const res = await thresholdsPost(
      makeReq({ thresholdOverrides: { z_floor: 2.5, abs_floor: 7 } }),
      { params: Promise.resolve({ triggerId: 'T-N1' }) },
    )
    expect(res.status).toBe(200)
    expect(clearCacheMock).toHaveBeenCalledTimes(1)
  })

  it('accepts null to clear overrides', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    upsertMock.mockResolvedValueOnce({ triggerId: 'T-N1', thresholdOverrides: null })
    const res = await thresholdsPost(
      makeReq({ thresholdOverrides: null }),
      { params: Promise.resolve({ triggerId: 'T-N1' }) },
    )
    expect(res.status).toBe(200)
  })

  it('rejects non-object thresholdOverrides', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    const res = await thresholdsPost(
      makeReq({ thresholdOverrides: [1, 2, 3] }),
      { params: Promise.resolve({ triggerId: 'T-N1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('rejects non-number threshold values', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    const res = await thresholdsPost(
      makeReq({ thresholdOverrides: { z_floor: 'two' } }),
      { params: Promise.resolve({ triggerId: 'T-N1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown triggerId', async () => {
    requireAdminMock.mockResolvedValueOnce({ user: { id: 'u', email: 'admin@test' } })
    const res = await thresholdsPost(
      makeReq({ thresholdOverrides: { z_floor: 2 } }),
      { params: Promise.resolve({ triggerId: 'T-FAKE' }) },
    )
    expect(res.status).toBe(404)
  })
})
