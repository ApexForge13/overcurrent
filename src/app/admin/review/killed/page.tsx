"use client"
import { useState, useEffect, useCallback } from 'react'

interface EditorialScores {
  specificity: number
  surprise: number
  clarity: number
  shareability: boolean
}

interface SensitivityFlags {
  outletDefamationRisk: 'low' | 'medium' | 'high'
  namedIndividualRisk: 'low' | 'medium' | 'high'
  governmentClassifiedRisk: 'low' | 'medium' | 'high'
  notes?: string
}

interface VerificationSummary {
  claimsChecked?: number
  claimsVerified?: number
  claimsUnknown?: number
  possibleHallucinations?: Array<{ claim: string; reason: string }>
  sourceFreshness?: string
  sourceFreshnessNote?: string
}

interface QualityReviewCard {
  id: string
  overallRecommendation: string
  patternVerified: boolean
  patternStressTestDetail: string
  verificationSummary: VerificationSummary
  editorialScores: EditorialScores
  sensitivityFlags: SensitivityFlags
  suggestedEdits: string | null
  reviewCost: number
  reviewDurationSeconds: number
  webSearchesRun: number
  createdAt: string
}

interface KilledRow {
  id: string
  slug: string
  headline: string
  synopsis: string
  thePattern: string | null
  sourceCount: number
  signalCategory: string | null
  primaryCategory: string | null
  createdAt: string
  qualityReviewCard: QualityReviewCard
}

const RISK_COLOR: Record<string, string> = {
  low: 'text-text-muted',
  medium: 'text-accent-amber',
  high: 'text-accent-red',
}

export default function AdminKilledQueue() {
  const [rows, setRows] = useState<KilledRow[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const fetchRows = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/review/killed')
      .then((r) => r.json())
      .then((data) => setRows(data.stories ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function revive(id: string) {
    setAction((s) => ({ ...s, [id]: 'reviving...' }))
    try {
      await fetch(`/api/admin/stories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'review' }),
      })
      setRows((prev) => prev.filter((r) => r.id !== id))
    } finally {
      setAction((s) => {
        const next = { ...s }; delete next[id]; return next
      })
    }
  }

  const hallucinationsCount = rows.reduce(
    (acc, r) => acc + (r.qualityReviewCard?.verificationSummary?.possibleHallucinations?.length ?? 0),
    0,
  )
  const patternDisproved = rows.filter((r) => r.qualityReviewCard?.patternVerified === false).length
  const highRisk = rows.filter((r) => {
    const f = r.qualityReviewCard?.sensitivityFlags
    if (!f) return false
    return f.outletDefamationRisk === 'high' || f.namedIndividualRisk === 'high' || f.governmentClassifiedRisk === 'high'
  }).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-xl text-text-primary">── AUTO-KILLED ARCHIVE ─────────</h2>
        <p className="text-xs text-text-muted font-mono mt-1">
          Stories the quality review agent killed before admin review. Use this surface to tune
          the agent — if it kills stories you would have published, adjust the system prompt.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 text-xs font-mono">
        <div className="border border-border p-3">
          <div className="text-text-muted">TOTAL KILLED</div>
          <div className="text-accent-red text-2xl font-bold">{rows.length}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">HALLUCINATIONS</div>
          <div className="text-accent-red text-2xl font-bold">{hallucinationsCount}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">PATTERN DISPROVED</div>
          <div className="text-accent-red text-2xl font-bold">{patternDisproved}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">HIGH RISK</div>
          <div className="text-accent-red text-2xl font-bold">{highRisk}</div>
        </div>
      </div>

      {loading && <div className="text-text-muted font-mono text-sm">Loading…</div>}

      {!loading && rows.length === 0 && (
        <div className="text-text-muted font-mono text-sm py-8 text-center border border-border">
          Nothing auto-killed yet. Queue will populate as the quality review agent runs.
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const card = row.qualityReviewCard
          const verif = card.verificationSummary
          const flags = card.sensitivityFlags
          const hallucinations = verif?.possibleHallucinations ?? []
          const isExpanded = !!expanded[row.id]
          return (
            <div key={row.id} className="border border-accent-red p-4 bg-background">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-mono text-text-muted mb-1">
                    <span className="px-2 py-0.5 border border-accent-red text-accent-red uppercase font-bold">
                      KILLED
                    </span>
                    {row.signalCategory && <span>{row.signalCategory}</span>}
                    <span>· {row.sourceCount} sources</span>
                    <span>· killed {new Date(card.createdAt).toLocaleString()}</span>
                  </div>
                  <h3 className="font-display font-bold text-lg text-text-primary leading-tight">
                    {row.headline}
                  </h3>
                  <p className="text-sm text-text-secondary mt-1 line-clamp-2">{row.synopsis}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono mt-3 pb-3 border-b border-border/40">
                <div>
                  <div className="text-text-muted">PATTERN</div>
                  <div className={card.patternVerified ? 'text-accent-green' : 'text-accent-red'}>
                    {card.patternVerified ? 'verified' : 'disproved'}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted">HALLUCINATIONS</div>
                  <div className={hallucinations.length > 0 ? 'text-accent-red' : 'text-text-muted'}>
                    {hallucinations.length}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted">HIGHEST RISK</div>
                  <div className={RISK_COLOR[
                    flags.outletDefamationRisk === 'high' || flags.namedIndividualRisk === 'high' || flags.governmentClassifiedRisk === 'high'
                      ? 'high'
                      : flags.outletDefamationRisk === 'medium' || flags.namedIndividualRisk === 'medium' || flags.governmentClassifiedRisk === 'medium'
                      ? 'medium'
                      : 'low'
                  ]}>
                    {(() => {
                      const order = ['high', 'medium', 'low']
                      const worst = order.find((lvl) =>
                        flags.outletDefamationRisk === lvl ||
                        flags.namedIndividualRisk === lvl ||
                        flags.governmentClassifiedRisk === lvl,
                      )
                      return worst ?? 'low'
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted">COST</div>
                  <div className="text-text-secondary">
                    ${card.reviewCost.toFixed(3)} · {card.webSearchesRun} searches
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-3 text-sm mt-3">
                  {row.thePattern && (
                    <div>
                      <div className="text-xs font-mono text-text-muted mb-1">PATTERN</div>
                      <div className="text-text-secondary italic">&ldquo;{row.thePattern}&rdquo;</div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-mono text-text-muted mb-1">PATTERN STRESS TEST</div>
                    <div className="text-text-secondary">{card.patternStressTestDetail}</div>
                  </div>
                  {hallucinations.length > 0 && (
                    <div className="border border-accent-red/40 p-3">
                      <div className="text-xs font-mono text-accent-red font-bold mb-2">POSSIBLE HALLUCINATIONS</div>
                      <ul className="space-y-1 text-xs text-text-secondary">
                        {hallucinations.map((h, i) => (
                          <li key={i}>• <span className="text-text-primary">{h.claim}</span> — {h.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {flags.notes && (
                    <div className="text-xs font-mono text-accent-amber">{flags.notes}</div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [row.id]: !e[row.id] }))}
                  className="text-xs font-mono text-text-muted hover:text-text-primary"
                >
                  {isExpanded ? '[collapse]' : '[expand]'}
                </button>
                <a
                  href={`/story/${row.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-text-muted hover:text-text-primary"
                >
                  [view story]
                </a>
                <div className="flex-1" />
                <button
                  onClick={() => revive(row.id)}
                  disabled={!!action[row.id]}
                  className="px-3 py-1 text-xs font-mono border border-accent-amber text-accent-amber hover:bg-accent-amber/10 disabled:opacity-50"
                  title="Move back to the review queue for manual decision"
                >
                  {action[row.id] ?? 'Revive to Review'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
