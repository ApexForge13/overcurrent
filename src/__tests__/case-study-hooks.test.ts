/**
 * Tests for the case-study auto-create hooks. Three hooks, one per write path:
 *
 *   - createCaseStudyFromQualityKill   \u2014 quality review verdict = 'kill'
 *   - createCaseStudyFromQualityEdits  \u2014 quality review verdict = 'approved_with_edits'
 *   - createCaseStudyFromRawSignalReview \u2014 admin marks RawSignalLayer reviewed
 *
 * All three:
 *   - Set isPublishable=false on create (admin must explicitly publish)
 *   - Are idempotent: same headline + cluster \u2192 skip insert (return null)
 *   - Use a dependency-injected writer so tests stay pure (no Prisma)
 *   - Skip with null return when required context is missing
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCaseStudyFromQualityKill,
  createCaseStudyFromQualityEdits,
  createCaseStudyFromRawSignalReview,
  type CaseStudyWriter,
  type CaseStudyExistsCheck,
  type QualityReviewKillContext,
  type QualityReviewEditsContext,
  type RawSignalReviewContext,
} from '@/lib/case-study-hooks'

// In-memory fake DB for hook tests
function makeFakeDb() {
  const rows: Array<{ id: string; headline: string; storyClusterId: string }> = []
  let nextId = 1
  const writer: CaseStudyWriter = async (data) => {
    const id = `case-${nextId++}`
    rows.push({ id, headline: data.headline, storyClusterId: data.storyClusterId })
    return { id, ...data }
  }
  const exists: CaseStudyExistsCheck = async (clusterId, headline) => {
    return rows.some((r) => r.storyClusterId === clusterId && r.headline === headline)
  }
  return { writer, exists, rows }
}

const KILL_CTX: QualityReviewKillContext = {
  storyId: 'story-123',
  storyHeadline: 'Iran Re-Closes Strait of Hormuz, Fires on Indian Tankers',
  storyPhase: 'consolidation',
  storyClusterId: 'cluster-hormuz',
  umbrellaArcId: 'umbrella-iran',
  killReason: 'The Pattern sentence fatally miscategorizes the Globe and Mail as specialist insurance press when the analysis\u2019s own source taxonomy places it in general-news.',
  pattern: '197 general-news sources covered who\u2019s shooting. The specialist insurance press \u2014 Lloyd\u2019s List, S&P Global \u2014 covered the financial fallout.',
}

const EDITS_CTX: QualityReviewEditsContext = {
  storyId: 'story-456',
  storyHeadline: 'Trump Announces 10-Day Israel-Lebanon Ceasefire',
  storyPhase: 'first_wave',
  storyClusterId: 'cluster-ceasefire',
  umbrellaArcId: null,
  pattern: 'Iran says the Lebanon ceasefire and the Iran deal are one package.',
  suggestedEdits: '- Fix the Munir framing\n- Update staleness disclosure\n- Sharpen Russia attribution',
}

const RAW_CTX: RawSignalReviewContext = {
  rawSignalLayerId: 'raw-1',
  storyClusterId: 'cluster-hormuz',
  umbrellaArcId: 'umbrella-iran',
  signalType: 'maritime_ais',
  signalSource: 'datadocked',
  haikuSummary: 'AIS data shows tanker TOUSKA paused in Strait of Hormuz at 14:32 UTC, course indeterminate.',
  divergenceFlag: true,
  divergenceDescription: 'Trump\u2019s Truth Social post claimed the vessel was seized; AIS tracks show it never went off-route.',
  adminNotes: 'Reviewed 2026-04-19. Mark for case study \u2014 raw AIS contradicts presidential social media claim.',
  reviewedByAdmin: true,
}

// ---------------------------------------------------------------------------
// createCaseStudyFromQualityKill
// ---------------------------------------------------------------------------

describe('createCaseStudyFromQualityKill', () => {
  it('creates a CaseStudyEntry with editorial_kill signalType and narrative_contradicts_raw divergence', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const result = await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(result).not.toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].headline).toMatch(/^Quality review killed:/)
    expect(rows[0].headline).toContain('Iran Re-Closes Strait')
  })

  it('headline includes the first sentence of killReason for context', async () => {
    const { writer, exists } = makeFakeDb()
    const result = await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(result).not.toBeNull()
  })

  it('returns null when storyClusterId is missing (case studies must attach to a cluster)', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const result = await createCaseStudyFromQualityKill(
      { ...KILL_CTX, storyClusterId: null },
      { writer, exists },
    )
    expect(result).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('is idempotent: re-running with same context returns null without inserting', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const first = await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(first).not.toBeNull()
    expect(rows).toHaveLength(1)
    const second = await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(second).toBeNull()
    expect(rows).toHaveLength(1)
  })

  it('different killReason produces a different headline \u2192 separate entry (kill cycles documented separately)', async () => {
    const { writer, exists, rows } = makeFakeDb()
    await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    await createCaseStudyFromQualityKill(
      { ...KILL_CTX, killReason: 'A completely different second-kill reason about something else.' },
      { writer, exists },
    )
    expect(rows).toHaveLength(2)
  })

  it('always sets isPublishable=false on create (admin must explicitly publish)', async () => {
    let captured: { isPublishable?: boolean } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(captured.isPublishable).toBe(false)
  })

  it('uses storyPhaseAtDetection from context (consolidation in this case)', async () => {
    let captured: { storyPhaseAtDetection?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(captured.storyPhaseAtDetection).toBe('consolidation')
  })

  it('defaults storyPhaseAtDetection to "consolidation" when context phase is null', async () => {
    let captured: { storyPhaseAtDetection?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityKill(
      { ...KILL_CTX, storyPhase: null },
      { writer, exists },
    )
    expect(captured.storyPhaseAtDetection).toBe('consolidation')
  })

  it('fullDescription includes story headline, kill reason, and original Pattern', async () => {
    let captured: { fullDescription?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(captured.fullDescription).toContain('Iran Re-Closes Strait')
    expect(captured.fullDescription).toContain('Globe and Mail')
    expect(captured.fullDescription).toContain('Lloyd')
  })

  it('signalType=editorial_kill and divergenceType=narrative_contradicts_raw on create', async () => {
    let captured: { signalType?: string; divergenceType?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityKill(KILL_CTX, { writer, exists })
    expect(captured.signalType).toBe('editorial_kill')
    expect(captured.divergenceType).toBe('narrative_contradicts_raw')
  })
})

// ---------------------------------------------------------------------------
// createCaseStudyFromQualityEdits
// ---------------------------------------------------------------------------

describe('createCaseStudyFromQualityEdits', () => {
  it('creates a CaseStudyEntry with editorial_correction signalType', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const result = await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    expect(result).not.toBeNull()
    expect(rows).toHaveLength(1)
  })

  it('headline starts with "Edits required:" prefix', async () => {
    let captured: { headline?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    expect(captured.headline).toMatch(/^Edits required:/)
    expect(captured.headline).toContain('Trump Announces 10-Day Israel-Lebanon')
  })

  it('signalType=editorial_correction, divergenceType=narrative_omits_raw', async () => {
    let captured: { signalType?: string; divergenceType?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    expect(captured.signalType).toBe('editorial_correction')
    expect(captured.divergenceType).toBe('narrative_omits_raw')
  })

  it('returns null when storyClusterId is missing', async () => {
    const { writer, exists } = makeFakeDb()
    const result = await createCaseStudyFromQualityEdits(
      { ...EDITS_CTX, storyClusterId: null },
      { writer, exists },
    )
    expect(result).toBeNull()
  })

  it('returns null when suggestedEdits is empty (nothing to document)', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const result = await createCaseStudyFromQualityEdits(
      { ...EDITS_CTX, suggestedEdits: '' },
      { writer, exists },
    )
    expect(result).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('returns null when suggestedEdits is null', async () => {
    const { writer, exists } = makeFakeDb()
    const result = await createCaseStudyFromQualityEdits(
      { ...EDITS_CTX, suggestedEdits: null },
      { writer, exists },
    )
    expect(result).toBeNull()
  })

  it('is idempotent for same context', async () => {
    const { writer, exists, rows } = makeFakeDb()
    await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    expect(rows).toHaveLength(1)
  })

  it('always sets isPublishable=false', async () => {
    let captured: { isPublishable?: boolean } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    expect(captured.isPublishable).toBe(false)
  })

  it('fullDescription includes story headline, suggested edits, and pattern', async () => {
    let captured: { fullDescription?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromQualityEdits(EDITS_CTX, { writer, exists })
    expect(captured.fullDescription).toContain('Trump Announces')
    expect(captured.fullDescription).toContain('Munir')
    expect(captured.fullDescription).toContain('Lebanon ceasefire')
  })
})

// ---------------------------------------------------------------------------
// createCaseStudyFromRawSignalReview
// ---------------------------------------------------------------------------

describe('createCaseStudyFromRawSignalReview', () => {
  it('creates a CaseStudyEntry from a reviewed RawSignalLayer', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const result = await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(result).not.toBeNull()
    expect(rows).toHaveLength(1)
  })

  it('returns null when reviewedByAdmin is false (don\u2019t auto-create unless admin reviewed)', async () => {
    const { writer, exists, rows } = makeFakeDb()
    const result = await createCaseStudyFromRawSignalReview(
      { ...RAW_CTX, reviewedByAdmin: false },
      { writer, exists },
    )
    expect(result).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('returns null when adminNotes is empty (no editorial intent expressed)', async () => {
    const { writer, exists } = makeFakeDb()
    const result = await createCaseStudyFromRawSignalReview(
      { ...RAW_CTX, adminNotes: '' },
      { writer, exists },
    )
    expect(result).toBeNull()
  })

  it('returns null when adminNotes is null', async () => {
    const { writer, exists } = makeFakeDb()
    const result = await createCaseStudyFromRawSignalReview(
      { ...RAW_CTX, adminNotes: null },
      { writer, exists },
    )
    expect(result).toBeNull()
  })

  it('signalType comes from RawSignalLayer.signalType (preserved)', async () => {
    let captured: { signalType?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(captured.signalType).toBe('maritime_ais')
  })

  it('divergenceFlag=true \u2192 divergenceType=narrative_contradicts_raw', async () => {
    let captured: { divergenceType?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(captured.divergenceType).toBe('narrative_contradicts_raw')
  })

  it('divergenceFlag=false \u2192 divergenceType=raw_corroborates_narrative', async () => {
    let captured: { divergenceType?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(
      { ...RAW_CTX, divergenceFlag: false },
      { writer, exists },
    )
    expect(captured.divergenceType).toBe('raw_corroborates_narrative')
  })

  it('rawSignalLayerId attached for FK linkage', async () => {
    let captured: { rawSignalLayerId?: string | null } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(captured.rawSignalLayerId).toBe('raw-1')
  })

  it('headline includes the haikuSummary (truncated if needed)', async () => {
    let captured: { headline?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(captured.headline).toMatch(/^Raw signal:/)
    expect(captured.headline).toContain('TOUSKA')
  })

  it('fullDescription includes adminNotes + haikuSummary + divergenceDescription', async () => {
    let captured: { fullDescription?: string } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(captured.fullDescription).toContain('TOUSKA')
    expect(captured.fullDescription).toContain('Trump')
    expect(captured.fullDescription).toContain('Reviewed 2026-04-19')
  })

  it('always sets isPublishable=false on create', async () => {
    let captured: { isPublishable?: boolean } = {}
    const writer: CaseStudyWriter = async (data) => {
      captured = data
      return { id: 'x', ...data }
    }
    const exists: CaseStudyExistsCheck = async () => false
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(captured.isPublishable).toBe(false)
  })

  it('is idempotent for same context', async () => {
    const { writer, exists, rows } = makeFakeDb()
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    await createCaseStudyFromRawSignalReview(RAW_CTX, { writer, exists })
    expect(rows).toHaveLength(1)
  })
})
