"use client"
import { useEffect, useState, useCallback } from 'react'
import { notFound } from 'next/navigation'
import { featureFlags } from '@/lib/feature-flags'

// Session 3 Step 6 — Predictive Signals admin page with data-quality banners.

interface PredictiveSignal {
  id: string
  predictedDominantFraming: string
  framingConfidencePct: number
  momentumFlag: 'stable' | 'shifting' | 'contested'
  momentumReason: string
  computedFromAnalysesCount: number
  generatedAt: string
  cluster: {
    id: string
    headline: string
    signalCategory: string | null
    arcCompleteness: string | null
  }
  story: { id: string; slug: string; headline: string } | null
  breakdown: {
    complete: number
    partial: number
    first_wave_only: number
    incomplete: number
    unclassified: number
    skippedPhases: number
    umbrellas: Array<{ id: string; name: string; arcCompleteness: string | null; arcLabel: string | null }>
  }
}

function formatCategory(c: string | null): string {
  if (!c) return '—'
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function formatPhase(p: string | null): string {
  if (!p) return '—'
  return p.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export default function PredictiveSignalsPage() {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) notFound()
  const [signals, setSignals] = useState<PredictiveSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/predictive-signals?limit=50')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setSignals(data.signals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  return (
    <div>
      <div className="mb-6">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.12em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '8px' }}>
          Admin · Signals
        </div>
        <h2 className="font-display font-bold text-2xl">Predictive Signals</h2>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
          First-wave predictions with arc-quality data banners. Confidence is capped at 60% when fewer than 5 complete arcs contributed.
        </p>
      </div>

      {error && <p style={{ color: 'var(--accent-red)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Error: {error}</p>}
      {loading && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</p>}

      {!loading && signals.length === 0 && !error && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', padding: '32px 0', textAlign: 'center' }}>
          No predictive signals computed yet. These are generated for first_wave analyses automatically.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {signals.map(s => <SignalCard key={s.id} signal={s} />)}
      </div>
    </div>
  )
}

function SignalCard({ signal }: { signal: PredictiveSignal }) {
  const insufficientData = signal.breakdown.complete < 5
  const confidenceColor =
    signal.framingConfidencePct >= 70 ? 'var(--accent-green)' :
    signal.framingConfidencePct >= 40 ? 'var(--accent-amber)' :
    'var(--text-tertiary)'
  const momentumColor =
    signal.momentumFlag === 'stable' ? 'var(--accent-green)' :
    signal.momentumFlag === 'shifting' ? 'var(--accent-blue)' :
    'var(--accent-red)'

  return (
    <div style={{
      border: '1px solid var(--border-primary)',
      background: 'var(--bg-secondary)',
      padding: 20,
    }}>
      {/* Top row: cluster headline + category + timestamp */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          {signal.story ? (
            <a href={`/story/${signal.story.slug}`} style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
              {signal.cluster.headline}
            </a>
          ) : (
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              {signal.cluster.headline}
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', background: 'var(--border-primary)', color: 'var(--text-secondary)', borderRadius: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {formatCategory(signal.cluster.signalCategory)}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
          Generated {new Date(signal.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>

      {/* Prediction row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16,
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
            Predicted Framing
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            {formatCategory(signal.predictedDominantFraming)}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
            Confidence
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: confidenceColor }}>
            {signal.framingConfidencePct}%
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
            Momentum
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: momentumColor, textTransform: 'uppercase', marginTop: 6 }}>
            {signal.momentumFlag}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
            Prior Analyses
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)', marginTop: 6 }}>
            {signal.computedFromAnalysesCount}
          </div>
        </div>
      </div>

      {/* Momentum reason */}
      {signal.momentumReason && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.4 }}>
          {signal.momentumReason}
        </p>
      )}

      {/* Data quality banner (Step 6) */}
      <div style={{
        border: `1px solid ${insufficientData ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
        borderLeft: `3px solid ${insufficientData ? 'var(--accent-amber)' : 'var(--accent-green)'}`,
        padding: '10px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Data Quality
          </span>
          {insufficientData && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', background: 'var(--accent-amber)', color: '#0A0A0B', borderRadius: 2, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Insufficient Data
            </span>
          )}
          {signal.breakdown.skippedPhases > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent-amber)' }}>
              {signal.breakdown.skippedPhases} skipped phase{signal.breakdown.skippedPhases === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap', marginBottom: signal.breakdown.umbrellas.length > 0 ? 10 : 0 }}>
          <QualityStat label="Complete" value={signal.breakdown.complete} color="var(--accent-green)" />
          <QualityStat label="Partial" value={signal.breakdown.partial} color="var(--accent-blue)" />
          <QualityStat label="First Wave Only" value={signal.breakdown.first_wave_only} color="var(--accent-amber)" />
          <QualityStat label="Incomplete" value={signal.breakdown.incomplete} color="var(--accent-red)" />
          {signal.breakdown.unclassified > 0 && (
            <QualityStat label="Unclassified" value={signal.breakdown.unclassified} color="var(--text-tertiary)" />
          )}
        </div>
        {signal.breakdown.umbrellas.length > 0 && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Contributing arcs:{' '}
            {signal.breakdown.umbrellas.slice(0, 8).map((u, i) => (
              <span key={u.id}>
                {i > 0 && ', '}
                <a href={`/admin/signals/umbrellas/${u.id}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                  {u.arcLabel ?? u.name} ({formatPhase(u.arcCompleteness)})
                </a>
              </span>
            ))}
            {signal.breakdown.umbrellas.length > 8 && <span> …</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function QualityStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{label.toLowerCase()}</span>
    </div>
  )
}
