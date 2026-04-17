import { describe, it, expect } from 'vitest'
import type { OutletInfo } from '@/data/outlets'
import { mapOutlet, mapRegion, mapEditorialType, mapTier, normalizeDomain } from '@/lib/outlet-map'

// Helper to make a minimal OutletInfo for testing
function makeOutlet(overrides: Partial<OutletInfo>): OutletInfo {
  return {
    name: 'Test Outlet',
    domain: 'test.com',
    country: 'US',
    region: 'North America',
    type: 'newspaper',
    politicalLean: 'center',
    reliability: 'medium',
    language: 'en',
    ...overrides,
  }
}

describe('normalizeDomain', () => {
  it('strips www, protocol, trailing slash', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com')
    expect(normalizeDomain('https://www.example.com/')).toBe('example.com')
    expect(normalizeDomain('HTTPS://EXAMPLE.COM')).toBe('example.com')
    expect(normalizeDomain('example.com/path')).toBe('example.com')
  })
})

describe('mapRegion', () => {
  it('maps Title-Case to snake_case', () => {
    expect(mapRegion('North America')).toBe('north_america')
    expect(mapRegion('Europe')).toBe('europe')
    expect(mapRegion('Asia-Pacific')).toBe('asia_pacific')
    expect(mapRegion('Middle East & Africa')).toBe('middle_east')
    expect(mapRegion('Latin America')).toBe('latin_america')
  })

  it('merges South & Central Asia into asia_pacific', () => {
    expect(mapRegion('South & Central Asia')).toBe('asia_pacific')
  })

  it('falls back to "global" for unknown regions', () => {
    expect(mapRegion('Unknown')).toBe('global')
    expect(mapRegion('')).toBe('global')
  })
})

describe('mapEditorialType', () => {
  it('wire type stays wire', () => {
    expect(mapEditorialType(makeOutlet({ type: 'wire' }))).toBe('wire')
  })

  it('state type stays state', () => {
    expect(mapEditorialType(makeOutlet({ type: 'state' }))).toBe('state')
  })

  it('state-controlled lean maps to state even if type is newspaper', () => {
    expect(mapEditorialType(makeOutlet({ type: 'newspaper', politicalLean: 'state-controlled' }))).toBe('state')
  })

  it('aggregator domains map to aggregator', () => {
    expect(mapEditorialType(makeOutlet({ domain: 'allafrica.com' }))).toBe('aggregator')
  })

  it('known independent domains map to independent', () => {
    expect(mapEditorialType(makeOutlet({ domain: 'meduza.io' }))).toBe('independent')
    expect(mapEditorialType(makeOutlet({ domain: 'caixinglobal.com' }))).toBe('independent')
    expect(mapEditorialType(makeOutlet({ domain: 'propublica.org' }))).toBe('independent')
  })

  it('default newspaper/broadcaster/digital → mainstream', () => {
    expect(mapEditorialType(makeOutlet({ domain: 'nytimes.com', type: 'newspaper' }))).toBe('mainstream')
    expect(mapEditorialType(makeOutlet({ domain: 'cnn.com', type: 'broadcaster' }))).toBe('mainstream')
    expect(mapEditorialType(makeOutlet({ domain: 'axios.com', type: 'digital' }))).toBe('mainstream')
  })
})

describe('mapTier', () => {
  it('wire type → wire_service', () => {
    expect(mapTier(makeOutlet({ type: 'wire', domain: 'apnews.com' }))).toBe('wire_service')
    expect(mapTier(makeOutlet({ type: 'wire', domain: 'reuters.com' }))).toBe('wire_service')
  })

  it('MUST-HAVE + G7 country → national', () => {
    expect(mapTier(makeOutlet({ domain: 'nytimes.com', country: 'US' }))).toBe('national')
    expect(mapTier(makeOutlet({ domain: 'bbc.com', country: 'GB' }))).toBe('national')
    expect(mapTier(makeOutlet({ domain: 'dw.com', country: 'DE' }))).toBe('national')
  })

  it('MUST-HAVE from non-G7 still → national', () => {
    // Al Jazeera is MUST-HAVE but Qatar not in NATIONAL_COUNTRIES set
    expect(mapTier(makeOutlet({ domain: 'aljazeera.com', country: 'QA' }))).toBe('national')
    // NHK World is MUST-HAVE from Japan (in set)
    expect(mapTier(makeOutlet({ domain: 'nhk.or.jp', country: 'JP' }))).toBe('national')
  })

  it('EMERGING domains → emerging (priority over other tiers)', () => {
    expect(mapTier(makeOutlet({ domain: 'meduza.io', country: 'LV' }))).toBe('emerging')
    expect(mapTier(makeOutlet({ domain: 'caixinglobal.com', country: 'CN' }))).toBe('emerging')
    expect(mapTier(makeOutlet({ domain: 'madamasr.com', country: 'EG' }))).toBe('emerging')
    expect(mapTier(makeOutlet({ domain: 'efectococuyo.com', country: 'VE' }))).toBe('emerging')
  })

  it('new EMERGING additions (session 1 adjustments)', () => {
    expect(mapTier(makeOutlet({ domain: 'balkaninsight.com', country: 'RS' }))).toBe('emerging')
    expect(mapTier(makeOutlet({ domain: 'theconversation.com', country: 'GB' }))).toBe('emerging')
    expect(mapTier(makeOutlet({ domain: 'nikkei.com', country: 'JP' }))).toBe('emerging')
  })

  it('NATIONAL_OVERRIDE domains → national regardless of G7/MUST-HAVE', () => {
    // El País — Spain, not G7, not on MUST-HAVE list, but paper of record
    expect(mapTier(makeOutlet({ domain: 'elpais.com', country: 'ES' }))).toBe('national')
    // Globe and Mail — Canada is G7 but not on MUST-HAVE list
    expect(mapTier(makeOutlet({ domain: 'theglobeandmail.com', country: 'CA' }))).toBe('national')
    // Asahi — Japan is G7 but not on MUST-HAVE list
    expect(mapTier(makeOutlet({ domain: 'asahi.com', country: 'JP' }))).toBe('national')
  })

  it('SPECIALTY domains → specialty', () => {
    expect(mapTier(makeOutlet({ domain: 'al-monitor.com', country: 'US' }))).toBe('specialty')
    expect(mapTier(makeOutlet({ domain: 'defenseone.com', country: 'US' }))).toBe('specialty')
    expect(mapTier(makeOutlet({ domain: 'economist.com', country: 'GB' }))).toBe('specialty')
  })

  it('HIGH priority non-G7 → regional', () => {
    expect(mapTier(makeOutlet({ domain: 'thedailystar.net', country: 'BD' }))).toBe('regional')
    expect(mapTier(makeOutlet({ domain: 'clarin.com', country: 'AR' }))).toBe('regional')
  })

  it('non-priority non-G7 high-reliability → regional', () => {
    expect(mapTier(makeOutlet({
      domain: 'randomregionalpaper.kr',
      country: 'KR',
      type: 'newspaper',
      reliability: 'high',
    }))).toBe('regional')
  })

  it('unrecognized outlet → unclassified', () => {
    expect(mapTier(makeOutlet({
      domain: 'somerandom.com',
      country: 'XX',
      reliability: 'medium',
    }))).toBe('unclassified')
  })
})

describe('mapOutlet — full mapping', () => {
  it('maps AP to wire_service + wire type + north_america', () => {
    const result = mapOutlet(makeOutlet({
      name: 'Associated Press',
      domain: 'apnews.com',
      country: 'US',
      region: 'North America',
      type: 'wire',
      reliability: 'high',
    }))
    expect(result).toEqual({
      domain: 'apnews.com',
      name: 'Associated Press',
      country: 'US',
      region: 'north_america',
      editorialType: 'wire',
      politicalLean: 'center',
      reliability: 'high',
      language: 'en',
      tier: 'wire_service',
      priority: null,
    })
  })

  it('maps Meduza to emerging + independent', () => {
    const result = mapOutlet(makeOutlet({
      name: 'Meduza',
      domain: 'meduza.io',
      country: 'LV',
      region: 'Europe',
      type: 'digital',
      politicalLean: 'center-left',
      reliability: 'high',
    }))
    expect(result.tier).toBe('emerging')
    expect(result.editorialType).toBe('independent')
    expect(result.region).toBe('europe')
  })

  it('maps BBC to national + mainstream + europe', () => {
    const result = mapOutlet(makeOutlet({
      name: 'BBC News',
      domain: 'bbc.com',
      country: 'GB',
      region: 'Europe',
      type: 'state',
      politicalLean: 'center',
      reliability: 'high',
      priority: 'must-have',
    }))
    expect(result.tier).toBe('national')
    // BBC type='state' in OutletInfo but editorialType stays 'state' for signal
    expect(result.editorialType).toBe('state')
    expect(result.priority).toBe('must-have')
  })

  it('passes through priority field', () => {
    const result = mapOutlet(makeOutlet({ priority: 'high' }))
    expect(result.priority).toBe('high')
  })

  it('normalizes www. domain', () => {
    const result = mapOutlet(makeOutlet({ domain: 'www.nytimes.com' }))
    expect(result.domain).toBe('nytimes.com')
  })
})
