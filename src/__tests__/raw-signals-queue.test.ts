import { describe, it, expect } from 'vitest'
import { buildQueueEntries } from '@/lib/raw-signals/queue'
import { scanKeywords } from '@/lib/raw-signals/keyword-triggers'
import {
  matchCompaniesAndTickers,
  matchMaritimeChokepoints,
} from '@/lib/raw-signals/entity-matchers'

describe('Raw Signal trigger logic', () => {
  describe('Layer 1: category_trigger', () => {
    it('military_conflict triggers 8 satellite/aviation/maritime/gdelt/etc. sources', () => {
      const entries = buildQueueEntries('military_conflict', [], '')
      const types = entries.map((e) => e.signalType).sort()
      expect(types).toEqual(
        [
          'satellite_optical',
          'satellite_radar',
          'satellite_fire',
          'aviation_adsb',
          'maritime_ais',
          'gdelt',
          'copernicus_emergency',
          'sanctions_ofac',
        ].sort(),
      )
      // All should be category_trigger
      for (const e of entries) {
        expect(e.triggerLayer).toBe('category_trigger')
        expect(e.triggerReason).toContain('military_conflict')
      }
    })

    it('corporate_scandal triggers SEC + legal + financial', () => {
      const entries = buildQueueEntries('corporate_scandal', [], '')
      const types = new Set(entries.map((e) => e.signalType))
      expect(types.has('sec_filing')).toBe(true)
      expect(types.has('legal_courtlistener')).toBe(true)
      expect(types.has('financial_equity')).toBe(true)
      expect(types.has('financial_options')).toBe(true)
    })

    it('unknown category yields no category_trigger entries', () => {
      const entries = buildQueueEntries('unknown_category', [], '')
      expect(entries.filter((e) => e.triggerLayer === 'category_trigger')).toHaveLength(0)
    })

    it('null category yields no category_trigger entries', () => {
      const entries = buildQueueEntries(null, [], '')
      expect(entries.filter((e) => e.triggerLayer === 'category_trigger')).toHaveLength(0)
    })
  })

  describe('Layer 2: entity_trigger', () => {
    it('ticker-pattern entity triggers financial_equity + sec_filing', () => {
      const matches = matchCompaniesAndTickers(['AAPL', 'Joe Biden'])
      const types = matches.map((m) => m.signalType)
      expect(types).toContain('financial_equity')
      expect(types).toContain('sec_filing')
    })

    it('corporate-suffix entity triggers financial_equity + sec_filing', () => {
      const matches = matchCompaniesAndTickers(['BlackRock Inc', 'Elon Musk'])
      const types = matches.map((m) => m.signalType)
      expect(types).toContain('financial_equity')
      expect(types).toContain('sec_filing')
    })

    it('strait of hormuz triggers maritime_ais', () => {
      const matches = matchMaritimeChokepoints(['Iran', 'Strait of Hormuz', 'United States'])
      expect(matches).toHaveLength(1)
      expect(matches[0].signalType).toBe('maritime_ais')
      expect(matches[0].matchedEntity).toBe('Strait of Hormuz')
    })

    it('no chokepoint entities → no maritime_ais match', () => {
      const matches = matchMaritimeChokepoints(['Iran', 'United States', 'Benjamin Netanyahu'])
      expect(matches).toHaveLength(0)
    })
  })

  describe('Layer 3: keyword_trigger', () => {
    it('"sanctions" triggers sanctions_ofac', () => {
      const results = scanKeywords('The US imposed new sanctions on Iran.')
      const types = results.map((r) => r.signalType)
      expect(types).toContain('sanctions_ofac')
    })

    it('"lawsuit" triggers legal_courtlistener', () => {
      const results = scanKeywords('A class action lawsuit was filed yesterday.')
      const types = results.map((r) => r.signalType)
      expect(types).toContain('legal_courtlistener')
    })

    it('"oil prices" + "federal reserve" → fred_macro', () => {
      const results = scanKeywords('The federal reserve raised the interest rate.')
      const types = results.map((r) => r.signalType)
      expect(types).toContain('fred_macro')
    })

    it('empty text → no keyword matches', () => {
      expect(scanKeywords('')).toHaveLength(0)
    })

    it('unrelated text → no matches', () => {
      expect(scanKeywords('The weather is nice today.')).toHaveLength(0)
    })

    it('"tanker" triggers maritime_ais', () => {
      const results = scanKeywords('A tanker was seen near the strait.')
      const types = results.map((r) => r.signalType)
      expect(types).toContain('maritime_ais')
    })
  })

  describe('cross-layer deduplication', () => {
    it('military_conflict + "sanctions" keyword → sanctions_ofac appears once via category_trigger', () => {
      const entries = buildQueueEntries(
        'military_conflict',
        [],
        'The US imposed new sanctions.',
      )
      const sanctionsEntries = entries.filter((e) => e.signalType === 'sanctions_ofac')
      expect(sanctionsEntries).toHaveLength(1)
      // Category-layer wins (runs first)
      expect(sanctionsEntries[0].triggerLayer).toBe('category_trigger')
    })

    it('unknown category + ticker entity + "sanctions" keyword — entity and keyword both fire', () => {
      const entries = buildQueueEntries(
        'unknown_category',
        ['AAPL'],
        'Sanctions were imposed.',
      )
      const types = new Set(entries.map((e) => e.signalType))
      expect(types.has('financial_equity')).toBe(true)
      expect(types.has('sec_filing')).toBe(true)
      expect(types.has('sanctions_ofac')).toBe(true)
    })

    it('no triggers fired → empty entries list', () => {
      const entries = buildQueueEntries(null, [], 'Random unrelated text.')
      expect(entries).toHaveLength(0)
    })
  })
})
