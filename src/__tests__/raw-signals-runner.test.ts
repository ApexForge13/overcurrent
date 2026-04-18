import { describe, it, expect } from 'vitest'
import {
  registerIntegration,
  getRegisteredSignalTypes,
} from '@/lib/raw-signals/runner'
import type { IntegrationRunner } from '@/lib/raw-signals/runner'

describe('Raw Signal Runner', () => {
  it('registerIntegration adds a runner to the registry', () => {
    const dummyRunner: IntegrationRunner = async () => null
    registerIntegration('world_bank', dummyRunner)
    const types = getRegisteredSignalTypes()
    expect(types).toContain('world_bank')
  })

  it('GDELT runner is registered after importing integrations/index', async () => {
    await import('@/lib/raw-signals/integrations')
    const types = getRegisteredSignalTypes()
    expect(types).toContain('gdelt')
  })

  it('Sentinel Hub optical + SAR runners are registered', async () => {
    await import('@/lib/raw-signals/integrations')
    const types = getRegisteredSignalTypes()
    expect(types).toContain('satellite_optical')
    expect(types).toContain('satellite_radar')
  })

  it('Step 5 runners (courtlistener, ofac, nasa-firms) are registered', async () => {
    await import('@/lib/raw-signals/integrations')
    const types = getRegisteredSignalTypes()
    expect(types).toContain('legal_courtlistener')
    expect(types).toContain('sanctions_ofac')
    expect(types).toContain('satellite_fire')
  })
})
