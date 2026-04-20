import { describe, it, expect } from 'vitest'
import { mergeRegionalAnalyses, estimateFullDebateCost } from '@/lib/tier-dispatch'
import type { RegionalAnalysis } from '@/agents/regional'

function makeRegionalAnalysis(overrides: Partial<RegionalAnalysis> = {}): RegionalAnalysis {
  return {
    region: 'NA',
    claims: [],
    discrepancies: [],
    framingAnalysis: { framing: '', notableAngles: [] },
    omissions: [],
    sourceSummaries: [],
    costUsd: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// mergeRegionalAnalyses — combine up to 3 sub-region analyses into one
// ---------------------------------------------------------------------------

describe('mergeRegionalAnalyses', () => {
  it('returns the input verbatim when only one analysis is provided', () => {
    const single = makeRegionalAnalysis({
      region: 'Asia',
      claims: [{ claim: 'x', confidence: 'HIGH', supportedBy: ['outA'], contradictedBy: [] }],
      costUsd: 1.23,
    })
    const merged = mergeRegionalAnalyses([single])
    expect(merged).toEqual(single)
  })

  it('throws when given an empty array (caller bug guard)', () => {
    expect(() => mergeRegionalAnalyses([])).toThrow(/at least one/i)
  })

  it('throws when sub-analyses span multiple regions (caller bug guard)', () => {
    const a = makeRegionalAnalysis({ region: 'NA' })
    const b = makeRegionalAnalysis({ region: 'EU' })
    expect(() => mergeRegionalAnalyses([a, b])).toThrow(/same region/i)
  })

  it('concatenates claims, discrepancies, omissions, and sourceSummaries', () => {
    const full = makeRegionalAnalysis({
      claims: [{ claim: 'fullA', confidence: 'HIGH', supportedBy: ['AP'], contradictedBy: [] }],
      discrepancies: [{ issue: 'd1', sideA: 'a', sideB: 'b', sourcesA: [], sourcesB: [] }],
      omissions: [{ missing: 'om1', presentIn: 'NA', significance: 'high' }],
      sourceSummaries: [{ url: 'a', summary: 'AP summary' }],
      costUsd: 5.0,
    })
    const twoModel = makeRegionalAnalysis({
      claims: [{ claim: 'twoB', confidence: 'MEDIUM', supportedBy: ['Regional'], contradictedBy: [] }],
      sourceSummaries: [{ url: 'b', summary: 'Regional summary' }],
      costUsd: 1.5,
    })
    const haiku = makeRegionalAnalysis({
      claims: [{ claim: 'haikuC', confidence: 'LOW', supportedBy: ['NewPaper'], contradictedBy: [] }],
      sourceSummaries: [{ url: 'c', summary: 'NewPaper summary' }],
      costUsd: 0.05,
    })
    const merged = mergeRegionalAnalyses([full, twoModel, haiku])
    expect(merged.claims.map((c) => c.claim)).toEqual(['fullA', 'twoB', 'haikuC'])
    expect(merged.discrepancies).toHaveLength(1)
    expect(merged.omissions).toHaveLength(1)
    expect(merged.sourceSummaries.map((s) => s.url)).toEqual(['a', 'b', 'c'])
  })

  it('sums costs across sub-analyses', () => {
    const full = makeRegionalAnalysis({ costUsd: 5.0 })
    const twoModel = makeRegionalAnalysis({ costUsd: 1.5 })
    const haiku = makeRegionalAnalysis({ costUsd: 0.05 })
    const merged = mergeRegionalAnalyses([full, twoModel, haiku])
    expect(merged.costUsd).toBe(6.55)
  })

  it('framing prefers the first non-empty framing (full > 2-model > haiku)', () => {
    const full = makeRegionalAnalysis({
      framingAnalysis: { framing: 'Full debate framing', notableAngles: ['x'] },
    })
    const twoModel = makeRegionalAnalysis({
      framingAnalysis: { framing: 'Two-model framing', notableAngles: ['y'] },
    })
    const merged = mergeRegionalAnalyses([full, twoModel])
    expect(merged.framingAnalysis.framing).toBe('Full debate framing')
  })

  it('framing falls through to next non-empty when first sub-analysis has no framing', () => {
    const full = makeRegionalAnalysis({
      framingAnalysis: { framing: '', notableAngles: [] },
    })
    const twoModel = makeRegionalAnalysis({
      framingAnalysis: { framing: 'Two-model framing', notableAngles: ['y'] },
    })
    const merged = mergeRegionalAnalyses([full, twoModel])
    expect(merged.framingAnalysis.framing).toBe('Two-model framing')
  })

  it('notableAngles unions across all sub-analyses (dedup, order preserved)', () => {
    const full = makeRegionalAnalysis({
      framingAnalysis: { framing: 'F', notableAngles: ['a', 'b'] },
    })
    const twoModel = makeRegionalAnalysis({
      framingAnalysis: { framing: 'T', notableAngles: ['b', 'c'] },
    })
    const haiku = makeRegionalAnalysis({
      framingAnalysis: { framing: 'H', notableAngles: ['c', 'd'] },
    })
    const merged = mergeRegionalAnalyses([full, twoModel, haiku])
    expect(merged.framingAnalysis.notableAngles).toEqual(['a', 'b', 'c', 'd'])
  })

  it('preserves region from first sub-analysis (already validated equal)', () => {
    const a = makeRegionalAnalysis({ region: 'Africa' })
    const b = makeRegionalAnalysis({ region: 'Africa' })
    expect(mergeRegionalAnalyses([a, b]).region).toBe('Africa')
  })
})

// ---------------------------------------------------------------------------
// estimateFullDebateCost — derive what cost would have been with no skips
// ---------------------------------------------------------------------------

describe('estimateFullDebateCost', () => {
  it('uses observed full-debate cost-per-source as the per-source rate when available', () => {
    // 5 sources went through full debate at $1.50 total → $0.30/source observed.
    // 3 went through 2-model, 4 went through haiku.
    // Estimated full-equivalent for skipped: (3 + 4) * $0.30 = $2.10
    // Observed actual cost: $1.50 (full) + $0.45 (two-model) + $0.04 (haiku) = $1.99
    // Estimated full cost = $1.50 + $2.10 = $3.60
    const result = estimateFullDebateCost({
      fullDebateCount: 5,
      fullDebateActualCost: 1.50,
      twoModelCount: 3,
      twoModelActualCost: 0.45,
      haikuCount: 4,
      haikuActualCost: 0.04,
    })
    expect(result.estimatedFullCostUsd).toBeCloseTo(3.60, 2)
    expect(result.actualCostUsd).toBeCloseTo(1.99, 2)
    expect(result.savingsUsd).toBeCloseTo(1.61, 2)
  })

  it('falls back to constant per-source rate when no full debate ran', () => {
    // No full-debate observations — uses fallback. Defaults to $0.20/source.
    const result = estimateFullDebateCost({
      fullDebateCount: 0,
      fullDebateActualCost: 0,
      twoModelCount: 2,
      twoModelActualCost: 0.30,
      haikuCount: 3,
      haikuActualCost: 0.03,
    })
    // Estimated full = (2 + 3) * 0.20 = 1.00
    // Actual = 0 + 0.30 + 0.03 = 0.33
    expect(result.estimatedFullCostUsd).toBeCloseTo(1.00, 2)
    expect(result.actualCostUsd).toBeCloseTo(0.33, 2)
    expect(result.savingsUsd).toBeCloseTo(0.67, 2)
  })

  it('returns zero savings when nothing was skipped', () => {
    const result = estimateFullDebateCost({
      fullDebateCount: 6,
      fullDebateActualCost: 1.80,
      twoModelCount: 0,
      twoModelActualCost: 0,
      haikuCount: 0,
      haikuActualCost: 0,
    })
    expect(result.estimatedFullCostUsd).toBeCloseTo(1.80, 2)
    expect(result.actualCostUsd).toBeCloseTo(1.80, 2)
    expect(result.savingsUsd).toBe(0)
  })

  it('handles all-zero input gracefully (no debate at all)', () => {
    const result = estimateFullDebateCost({
      fullDebateCount: 0,
      fullDebateActualCost: 0,
      twoModelCount: 0,
      twoModelActualCost: 0,
      haikuCount: 0,
      haikuActualCost: 0,
    })
    expect(result.estimatedFullCostUsd).toBe(0)
    expect(result.actualCostUsd).toBe(0)
    expect(result.savingsUsd).toBe(0)
  })

  it('savings clamped to non-negative even if actual exceeds estimated', () => {
    // Pathological case — shouldn\u2019t happen but guard against it.
    const result = estimateFullDebateCost({
      fullDebateCount: 1,
      fullDebateActualCost: 10.00, // very expensive single source
      twoModelCount: 1,
      twoModelActualCost: 5.00, // also very expensive
      haikuCount: 0,
      haikuActualCost: 0,
    })
    // Estimated full per source = 10.00; estimated full for 2-model = 1*10 = 10
    // Estimated full total = 10 + 10 = 20; actual = 10 + 5 = 15; savings = 5
    expect(result.savingsUsd).toBeCloseTo(5.0, 2)
    expect(result.savingsUsd).toBeGreaterThanOrEqual(0)
  })
})
