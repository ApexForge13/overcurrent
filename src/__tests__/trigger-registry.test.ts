import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TRIGGER_DEFINITIONS, isTriggerEnabled, ALL_TRIGGER_IDS } from '@/lib/gap-score/triggers/registry'

describe('TRIGGER_DEFINITIONS', () => {
  it('registers exactly 7 event-driven + meta triggers for Phase 1c.1', () => {
    expect(ALL_TRIGGER_IDS).toHaveLength(7)
  })

  it('includes all 7 Phase 1c.1 IDs', () => {
    const expected = new Set(['T-GT1', 'T-GT2', 'T-GT3', 'T-GT9', 'T-GT10', 'T-META1', 'T-META2'])
    expect(new Set(ALL_TRIGGER_IDS)).toEqual(expected)
  })

  it('every definition has required fields', () => {
    for (const def of Object.values(TRIGGER_DEFINITIONS)) {
      expect(def.id).toBeTruthy()
      expect(def.description).toBeTruthy()
      expect(['narrative', 'psychological', 'ground_truth', 'meta']).toContain(def.stream)
      expect(def.enabledEnvVar).toMatch(/^TRIGGER_/)
    }
  })

  it('streams split: 5 ground_truth + 2 meta for Phase 1c.1', () => {
    const byStream: Record<string, number> = {}
    for (const def of Object.values(TRIGGER_DEFINITIONS)) {
      byStream[def.stream] = (byStream[def.stream] ?? 0) + 1
    }
    expect(byStream.ground_truth).toBe(5)
    expect(byStream.meta).toBe(2)
  })
})

describe('isTriggerEnabled', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    // Clear any test-local overrides
    for (const def of Object.values(TRIGGER_DEFINITIONS)) {
      delete process.env[def.enabledEnvVar]
    }
  })

  afterEach(() => {
    // NODE_ENV is read-only in strict TS mode; restore via index-delete if the
    // test happened to set it, else no-op. The isTriggerEnabled function
    // signature accepts a loose Record; tests pass env overrides directly.
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV
    } else {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv
    }
  })

  it('returns false for unknown trigger id', () => {
    expect(isTriggerEnabled('NOT_A_TRIGGER')).toBe(false)
  })

  it('returns true when env var is "true"', () => {
    expect(isTriggerEnabled('T-GT1', { TRIGGER_T_GT1_ENABLED: 'true' })).toBe(true)
  })

  it('returns true when env var is "1"', () => {
    expect(isTriggerEnabled('T-GT1', { TRIGGER_T_GT1_ENABLED: '1' })).toBe(true)
  })

  it('returns false when env var is "false"', () => {
    expect(isTriggerEnabled('T-GT1', { TRIGGER_T_GT1_ENABLED: 'false' })).toBe(false)
  })

  it('defaults to true when env unset + NODE_ENV is not production', () => {
    expect(isTriggerEnabled('T-GT1', { NODE_ENV: 'test' })).toBe(true)
    expect(isTriggerEnabled('T-GT1', { NODE_ENV: 'development' })).toBe(true)
  })

  it('defaults to false when env unset + NODE_ENV is production (conservative)', () => {
    expect(isTriggerEnabled('T-GT1', { NODE_ENV: 'production' })).toBe(false)
  })
})
