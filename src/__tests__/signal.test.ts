import { describe, it, expect } from 'vitest'
import { phaseFromHours, phaseFromDates } from '@/lib/signal/phase'
import { entityOverlapScore, headlineSimilarity } from '@/lib/signal/cluster'
import { FACT_TYPES } from '@/lib/signal/fact-omission'
import { SIGNAL_CATEGORIES } from '@/lib/signal/signal-category'

describe('phaseFromHours', () => {
  it('first_wave: 0-12h', () => {
    expect(phaseFromHours(0)).toBe('first_wave')
    expect(phaseFromHours(6)).toBe('first_wave')
    expect(phaseFromHours(11.99)).toBe('first_wave')
  })
  it('development: 12-48h', () => {
    expect(phaseFromHours(12)).toBe('development')
    expect(phaseFromHours(24)).toBe('development')
    expect(phaseFromHours(47.99)).toBe('development')
  })
  it('consolidation: 48h-7d', () => {
    expect(phaseFromHours(48)).toBe('consolidation')
    expect(phaseFromHours(72)).toBe('consolidation')
    expect(phaseFromHours(167.99)).toBe('consolidation')
  })
  it('tail: 7d+', () => {
    expect(phaseFromHours(168)).toBe('tail')
    expect(phaseFromHours(24 * 14)).toBe('tail')
    expect(phaseFromHours(24 * 365)).toBe('tail')
  })
})

describe('phaseFromDates', () => {
  it('first_wave when firstDetectedAt is missing', () => {
    expect(phaseFromDates(null)).toBe('first_wave')
    expect(phaseFromDates(undefined)).toBe('first_wave')
  })
  it('computes phase from time delta', () => {
    const first = new Date('2026-04-10T00:00:00Z')
    expect(phaseFromDates(first, new Date('2026-04-10T03:00:00Z'))).toBe('first_wave')
    expect(phaseFromDates(first, new Date('2026-04-10T18:00:00Z'))).toBe('development')
    expect(phaseFromDates(first, new Date('2026-04-13T00:00:00Z'))).toBe('consolidation')
    expect(phaseFromDates(first, new Date('2026-04-20T00:00:00Z'))).toBe('tail')
  })
})

describe('entityOverlapScore', () => {
  it('full overlap → 1.0', () => {
    expect(entityOverlapScore(['Hungary', 'Orban'], ['Hungary', 'Orban', 'Tisza'])).toBe(1.0)
  })
  it('partial overlap → fraction', () => {
    expect(entityOverlapScore(['Hungary', 'USA'], ['Hungary', 'Orban'])).toBe(0.5)
  })
  it('no overlap → 0', () => {
    expect(entityOverlapScore(['Iran'], ['Hungary', 'Orban'])).toBe(0)
  })
  it('case-insensitive', () => {
    expect(entityOverlapScore(['HUNGARY'], ['hungary'])).toBe(1.0)
  })
  it('diacritics-insensitive', () => {
    expect(entityOverlapScore(['Orbán'], ['Orban'])).toBe(1.0)
  })
  it('empty input → 0', () => {
    expect(entityOverlapScore([], ['Hungary'])).toBe(0)
    expect(entityOverlapScore(['Hungary'], [])).toBe(0)
  })
})

describe('headlineSimilarity', () => {
  it('identical headlines → 1.0', () => {
    expect(headlineSimilarity('Hungary election results', 'Hungary election results')).toBe(1.0)
  })
  it('no shared meaningful words → 0', () => {
    expect(headlineSimilarity('Iran missile strike', 'Market crash Tokyo')).toBe(0)
  })
  it('partial overlap', () => {
    const score = headlineSimilarity(
      'Hungary election Orban loses power',
      'Orban defeated in Hungary historic election',
    )
    expect(score).toBeGreaterThan(0.4)
    expect(score).toBeLessThanOrEqual(1.0)
  })
  it('ignores common stop words', () => {
    // Only "election" is meaningful in both → low similarity expected
    const score = headlineSimilarity('The election results', 'This is an election')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.7)
  })
  it('case and diacritic insensitive', () => {
    const score = headlineSimilarity('Orbán loses Hungarian election', 'ORBAN LOSES HUNGARIAN ELECTION')
    expect(score).toBe(1.0)
  })
})

describe('FACT_TYPES constants', () => {
  it('contains all 6 expected types', () => {
    expect(FACT_TYPES).toHaveLength(6)
    expect(FACT_TYPES).toContain('financial_detail')
    expect(FACT_TYPES).toContain('legal_finding')
    expect(FACT_TYPES).toContain('named_individual')
    expect(FACT_TYPES).toContain('government_statement')
    expect(FACT_TYPES).toContain('historical_context')
    expect(FACT_TYPES).toContain('casualty_figure')
  })
})

describe('SIGNAL_CATEGORIES constants', () => {
  it('contains all 9 expected categories', () => {
    expect(SIGNAL_CATEGORIES).toHaveLength(9)
    expect(SIGNAL_CATEGORIES).toContain('trade_dispute')
    expect(SIGNAL_CATEGORIES).toContain('military_conflict')
    expect(SIGNAL_CATEGORIES).toContain('election_coverage')
    expect(SIGNAL_CATEGORIES).toContain('corporate_scandal')
    expect(SIGNAL_CATEGORIES).toContain('political_scandal')
    expect(SIGNAL_CATEGORIES).toContain('diplomatic_negotiation')
    expect(SIGNAL_CATEGORIES).toContain('civil_unrest')
    expect(SIGNAL_CATEGORIES).toContain('economic_policy')
    expect(SIGNAL_CATEGORIES).toContain('environmental_event')
  })
})
