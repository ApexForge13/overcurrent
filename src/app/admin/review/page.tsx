"use client"
import { useState, useEffect, useCallback } from 'react'
import { notFound } from 'next/navigation'
import { featureFlags } from '@/lib/feature-flags'

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
  overallRecommendation: 'approved' | 'approved_with_edits' | 'hold' | 'kill'
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

interface ReviewRow {
  id: string
  slug: string
  headline: string
  synopsis: string
  thePattern: string | null
  confidenceLevel: string
  sourceCount: number
  countryCount: number
  signalCategory: string | null
  primaryCategory: string | null
  analysisType: string | null
  createdAt: string
  qualityReviewCard: QualityReviewCard | null
}

const RECOMMENDATION_COLORS: Record<string, string> = {
  approved: 'text-accent-green border-accent-green',
  approved_with_edits: 'text-accent-blue border-accent-blue',
  hold: 'text-accent-amber border-accent-amber',
  kill: 'text-accent-red border-accent-red',
}

const RISK_COLOR: Record<string, string> = {
  low: 'text-text-muted',
  medium: 'text-accent-amber',
  high: 'text-accent-red',
}

export default function AdminReviewQueue() {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) notFound()
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const fetchRows = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/review/list')
      .then((r) => r.json())
      .then((data) => setRows(data.stories ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function updateStatus(id: string, status: 'published' | 'archived') {
    setAction((s) => ({ ...s, [id]: status === 'published' ? 'approving...' : 'archiving...' }))
    try {
      await fetch(`/api/admin/stories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setRows((prev) => prev.filter((r) => r.id !== id))
    } finally {
      setAction((s) => {
        const next = { ...s }; delete next[id]; return next
      })
    }
  }

  async function runReview(id: string) {
    setAction((s) => ({ ...s, [id]: 'reviewing...' }))
    try {
      await fetch(`/api/admin/quality-review/${id}/run`, { method: 'POST' })
      fetchRows()
    } finally {
      setAction((s) => {
        const next = { ...s }; delete next[id]; return next
      })
    }
  }

  const counts = {
    hold: rows.filter((r) => r.qualityReviewCard?.overallRecommendation === 'hold').length,
    approvedWithEdits: rows.filter((r) => r.qualityReviewCard?.overallRecommendation === 'approved_with_edits').length,
    noCard: rows.filter((r) => !r.qualityReviewCard).length,
    approved: rows.filter((r) => r.qualityReviewCard?.overallRecommendation === 'approved').length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-xl text-text-primary">── REVIEW QUEUE ────────────────</h2>
        <p className="text-xs text-text-muted font-mono mt-1">
          Quality agent pre-screens every analysis before admin review. Killed verdicts auto-archive
          and live on <a className="text-accent-red hover:underline" href="/admin/review/killed">/admin/review/killed</a>.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 text-xs font-mono">
        <div className="border border-border p-3">
          <div className="text-text-muted">HOLD</div>
          <div className="text-accent-amber text-2xl font-bold">{counts.hold}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">APPROVED w/ EDITS</div>
          <div className="text-accent-blue text-2xl font-bold">{counts.approvedWithEdits}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">PENDING REVIEW</div>
          <div className="text-text-secondary text-2xl font-bold">{counts.noCard}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">APPROVED (clean)</div>
          <div className="text-accent-green text-2xl font-bold">{counts.approved}</div>
        </div>
      </div>

      {loading && <div className="text-text-muted font-mono text-sm">Loading…</div>}

      {!loading && rows.length === 0 && (
        <div className="text-text-muted font-mono text-sm py-8 text-center border border-border">
          Queue empty. Every pipeline run writes here. Killed verdicts are at /admin/review/killed.
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const card = row.qualityReviewCard
          const rec = card?.overallRecommendation ?? null
          const recColor = rec ? RECOMMENDATION_COLORS[rec] : 'text-text-muted border-border'
          const isExpanded = !!expanded[row.id]
          const scores = card?.editorialScores
          const flags = card?.sensitivityFlags
          const verif = card?.verificationSummary
          const hallucinations = verif?.possibleHallucinations ?? []
          return (
            <div key={row.id} className={`border ${recColor} p-4 bg-background`}>
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-mono text-text-muted mb-1">
                    <span className={`px-2 py-0.5 border ${recColor} uppercase font-bold`}>
                      {rec ?? 'NO REVIEW YET'}
                    </span>
                    {row.signalCategory && <span>{row.signalCategory}</span>}
                    {row.analysisType && <span>· {row.analysisType}</span>}
                    <span>· {row.sourceCount} sources</span>
                    <span>· {new Date(row.createdAt).toLocaleString()}</span>
                  </div>
                  <h3 className="font-display font-bold text-lg text-text-primary leading-tight">
                    {row.headline}
                  </h3>
                  <p className="text-sm text-text-secondary mt-1 line-clamp-2">{row.synopsis}</p>
                </div>
              </div>

              {card && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono mt-3 pb-3 border-b border-border/40">
                  <div>
                    <div className="text-text-muted">PATTERN</div>
                    <div className={card.patternVerified ? 'text-accent-green' : 'text-accent-red'}>
                      {card.patternVerified ? 'verified' : 'disproved'}
                    </div>
                  </div>
                  {scores && (
                    <>
                      <div>
                        <div className="text-text-muted">SPECIFICITY</div>
                        <div className={scores.specificity >= 7 ? 'text-accent-green' : 'text-accent-amber'}>
                          {scores.specificity}/10
                        </div>
                      </div>
                      <div>
                        <div className="text-text-muted">SURPRISE</div>
                        <div className={scores.surprise >= 7 ? 'text-accent-green' : 'text-accent-amber'}>
                          {scores.surprise}/10
                        </div>
                      </div>
                      <div>
                        <div className="text-text-muted">CLARITY</div>
                        <div className={scores.clarity >= 7 ? 'text-accent-green' : 'text-accent-amber'}>
                          {scores.clarity}/10
                        </div>
                      </div>
                    </>
                  )}
                  {flags && (
                    <>
                      <div>
                        <div className="text-text-muted">DEFAMATION</div>
                        <div className={RISK_COLOR[flags.outletDefamationRisk]}>{flags.outletDefamationRisk}</div>
                      </div>
                      <div>
                        <div className="text-text-muted">INDIVIDUAL</div>
                        <div className={RISK_COLOR[flags.namedIndividualRisk]}>{flags.namedIndividualRisk}</div>
                      </div>
                      <div>
                        <div className="text-text-muted">CLASSIFIED</div>
                        <div className={RISK_COLOR[flags.governmentClassifiedRisk]}>{flags.governmentClassifiedRisk}</div>
                      </div>
                    </>
                  )}
                  <div>
                    <div className="text-text-muted">COST</div>
                    <div className="text-text-secondary">
                      ${card.reviewCost.toFixed(3)} · {card.webSearchesRun} searches
                    </div>
                  </div>
                </div>
              )}

              {card && isExpanded && (
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
                  {verif && (
                    <div className="text-xs font-mono text-text-muted">
                      Claims checked: {verif.claimsChecked ?? '—'} · verified: {verif.claimsVerified ?? '—'} ·
                      unknown: {verif.claimsUnknown ?? '—'} · source freshness: {verif.sourceFreshness ?? '—'}
                    </div>
                  )}
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
                  {flags?.notes && (
                    <div className="text-xs font-mono text-accent-amber">{flags.notes}</div>
                  )}
                  {card.suggestedEdits && (
                    <div>
                      <div className="text-xs font-mono text-accent-blue mb-1">SUGGESTED EDITS</div>
                      <pre className="whitespace-pre-wrap text-xs text-text-secondary bg-black/20 p-2 border border-border">{card.suggestedEdits}</pre>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {card && (
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [row.id]: !e[row.id] }))}
                    className="text-xs font-mono text-text-muted hover:text-text-primary"
                  >
                    {isExpanded ? '[collapse]' : '[expand]'}
                  </button>
                )}
                <a
                  href={`/story/${row.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-text-muted hover:text-text-primary"
                >
                  [view story]
                </a>
                <div className="flex-1" />
                {!card && (
                  <button
                    onClick={() => runReview(row.id)}
                    disabled={!!action[row.id]}
                    className="px-3 py-1 text-xs font-mono border border-accent-teal text-accent-teal hover:bg-accent-teal/10 disabled:opacity-50"
                  >
                    {action[row.id] ?? 'Run Review'}
                  </button>
                )}
                <button
                  onClick={() => updateStatus(row.id, 'archived')}
                  disabled={!!action[row.id]}
                  className="px-3 py-1 text-xs font-mono border border-accent-red text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
                >
                  Kill
                </button>
                <button
                  onClick={() => updateStatus(row.id, 'published')}
                  disabled={!!action[row.id] || rec === 'hold'}
                  className="px-3 py-1 text-xs font-mono border border-accent-green text-accent-green hover:bg-accent-green/10 disabled:opacity-50"
                  title={rec === 'hold' ? 'Story is on hold — kill or manually override via DB' : undefined}
                >
                  {action[row.id] === 'approving...' ? 'approving…' : 'Approve'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
