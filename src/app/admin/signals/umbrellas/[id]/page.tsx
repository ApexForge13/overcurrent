"use client"
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

// Full umbrella detail view (5 sections: header, story arcs, one-offs, cross-event
// outlet behavior, manual observations) is built in Step 5. This file currently
// renders the header + stats + Step 4's Recommended Triggers card.

interface UmbrellaDetail {
  id: string
  name: string
  description: string | null
  status: string
  signalCategory: string
  scanFrequency: string
  firstAnalysisAt: string | null
  lastAnalysisAt: string | null
  totalAnalyses: number
  storyArcCount: number
  oneOffCount: number
  intelligenceScanLastRunAt: string | null
  notes: string | null
  createdAt: string
}

interface Recommendation {
  suggestedLabel: string
  recommendation: 'story_arc' | 'one_off'
  rationale: string
  estimatedPhase: 'first_wave' | 'development' | 'consolidation' | 'tail' | null
}

interface RecommendationsResponse {
  scanId: string | null
  ranAt: string | null
  recommendations: Recommendation[]
  limitedData: boolean
}

function formatCategory(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export default function UmbrellaDetailStub() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [umbrella, setUmbrella] = useState<UmbrellaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const fetchRecs = useCallback(async () => {
    if (!id) return
    try {
      const r = await fetch(`/api/admin/umbrellas/${id}/intelligence-scan`)
      if (!r.ok) return
      setRecs(await r.json())
    } catch {
      // ignore — non-fatal
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    fetch(`/api/admin/umbrellas/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setUmbrella(data.umbrella)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
    fetchRecs()
  }, [id, fetchRecs])

  async function runScan() {
    if (!id) return
    setScanning(true)
    setScanError(null)
    try {
      const r = await fetch(`/api/admin/umbrellas/${id}/intelligence-scan`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      setRecs({
        scanId: data.scanId,
        ranAt: data.ranAt,
        recommendations: data.recommendations,
        limitedData: data.limitedData,
      })
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  if (loading) {
    return <p className="text-sm font-mono text-text-muted">Loading...</p>
  }
  if (error || !umbrella) {
    return (
      <div>
        <a href="/admin/signals/umbrellas" className="text-xs font-mono text-text-tertiary hover:text-text-primary">
          &larr; All Umbrellas
        </a>
        <p className="mt-4 text-sm font-mono text-accent-red">{error ?? 'Not found'}</p>
      </div>
    )
  }

  return (
    <div>
      <a href="/admin/signals/umbrellas" className="text-xs font-mono text-text-tertiary hover:text-text-primary">
        &larr; All Umbrellas
      </a>

      <div className="mt-4 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-2xl">{umbrella.name}</h2>
            {umbrella.description && (
              <p className="mt-1 text-sm text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
                {umbrella.description}
              </p>
            )}
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: umbrella.status === 'active' ? 'var(--accent-green)' : 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              border: '1px solid',
              borderColor: umbrella.status === 'active' ? 'var(--accent-green)' : 'var(--border-primary)',
              padding: '2px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {umbrella.status}
          </span>
        </div>

        <div
          className="mt-4"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
          }}
        >
          <Stat label="Category" value={formatCategory(umbrella.signalCategory)} />
          <Stat label="Scan Frequency" value={umbrella.scanFrequency.replace(/_/g, ' ')} />
          <Stat label="Total Analyses" value={umbrella.totalAnalyses.toString()} />
          <Stat label="Story Arcs" value={umbrella.storyArcCount.toString()} />
          <Stat label="One-Offs" value={umbrella.oneOffCount.toString()} />
        </div>
      </div>

      {/* ── Recommended Triggers (Step 4) ───────────────────────────── */}
      <div
        style={{
          marginTop: 32,
          padding: 20,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Recommended Triggers
            </h3>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
              Haiku-suggested sub-events worth filing. Nothing auto-executes.
              {recs?.ranAt && (
                <> Last scan: {new Date(recs.ranAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>
              )}
            </p>
          </div>
          <button
            onClick={runScan}
            disabled={scanning}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '8px 16px',
              background: scanning ? 'var(--border-primary)' : 'var(--accent-green)',
              color: scanning ? 'var(--text-tertiary)' : '#0A0A0B',
              border: 'none',
              borderRadius: 3,
              cursor: scanning ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {scanning ? 'Scanning…' : 'Run Intelligence Scan'}
          </button>
        </div>

        {scanError && (
          <p style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
            {scanError}
          </p>
        )}

        {recs?.limitedData && (recs.recommendations.length > 0) && (
          <div style={{
            display: 'inline-block',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            padding: '3px 8px',
            background: 'var(--accent-amber)',
            color: '#0A0A0B',
            borderRadius: 2,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            Early Signal — Limited Data ({umbrella.totalAnalyses}/5 analyses)
          </div>
        )}

        {!recs || recs.recommendations.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', padding: '16px 0' }}>
            {recs?.ranAt
              ? 'No recommendations from the last scan. Umbrella may be too narrow or too new.'
              : 'No scan has been run yet. Click Run Intelligence Scan to generate recommendations.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recs.recommendations.map((r, idx) => (
              <RecommendationRow key={idx} umbrellaId={id ?? ''} rec={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RecommendationRow({ umbrellaId, rec }: { umbrellaId: string; rec: Recommendation }) {
  const kindColor = rec.recommendation === 'story_arc' ? 'var(--accent-green)' : 'var(--accent-blue)'

  // Build pre-fill URL for AnalyzeForm
  const params = new URLSearchParams()
  params.set('umbrella', umbrellaId)
  params.set('type', rec.recommendation === 'story_arc' ? 'new_arc' : 'umbrella_tagged')
  params.set('arcLabel', rec.suggestedLabel)
  if (rec.estimatedPhase) params.set('phase', rec.estimatedPhase)

  return (
    <div style={{
      border: '1px solid var(--border-primary)',
      borderLeft: `3px solid ${kindColor}`,
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {rec.suggestedLabel}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', background: kindColor, color: '#0A0A0B', borderRadius: 2, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {rec.recommendation === 'story_arc' ? 'Story Arc' : 'One-off'}
          </span>
          {rec.estimatedPhase && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', background: 'var(--border-primary)', color: 'var(--text-secondary)', borderRadius: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {rec.estimatedPhase.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {rec.rationale}
        </p>
      </div>
      <a
        href={`/admin?${params.toString()}`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          padding: '6px 10px',
          background: 'transparent',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 3,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Trigger Analysis
      </a>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          color: 'var(--text-muted)',
          fontSize: '10px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: '14px', marginTop: '2px' }}>{value}</div>
    </div>
  )
}
