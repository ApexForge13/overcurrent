import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TRIGGER_DEFINITIONS, isTriggerEnabled, ALL_TRIGGER_IDS } from '@/lib/gap-score/triggers/registry'

describe('TRIGGER_DEFINITIONS', () => {
  it('registers exactly 16 triggers post-1c.2b.1 (4 narrative + 4 psych + 6 ground-truth + 2 meta)', () => {
    expect(ALL_TRIGGER_IDS).toHaveLength(16)
  })

  it('includes all Phase 1c.1 + 1c.2a + 1c.2b.1 IDs', () => {
    const expected = new Set([
      // Narrative (1c.2b.1)
      'T-N1', 'T-N2', 'T-N3', 'T-N4',
      // Psychological (1c.2b.1)
      'T-P1', 'T-P2', 'T-P3', 'T-P4',
      // Ground-truth (1c.1 + 1c.2a + 1c.2b.1)
      'T-GT1', 'T-GT2', 'T-GT3', 'T-GT4', 'T-GT9', 'T-GT10',
      // Meta (1c.1)
      'T-META1', 'T-META2',
    ])
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

  it('streams split: 4 narrative + 4 psych + 6 ground_truth + 2 meta post-1c.2b.1', () => {
    const byStream: Record<string, number> = {}
    for (const def of Object.values(TRIGGER_DEFINITIONS)) {
      byStream[def.stream] = (byStream[def.stream] ?? 0) + 1
    }
    expect(byStream.narrative).toBe(4)
    expect(byStream.psychological).toBe(4)
    expect(byStream.ground_truth).toBe(6)
    expect(byStream.meta).toBe(2)
  })

  it('triggers that require baselines have baselineConfig populated', () => {
    for (const def of Object.values(TRIGGER_DEFINITIONS)) {
      if (def.requiresBaseline) {
        expect(def.baselineConfig).toBeDefined()
        expect(def.baselineConfig?.metricName).toBeTruthy()
        expect(def.baselineConfig?.windowDays).toBeGreaterThan(0)
      }
    }
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
