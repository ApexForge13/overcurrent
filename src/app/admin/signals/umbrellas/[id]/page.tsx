"use client"
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, notFound } from 'next/navigation'
import { featureFlags } from '@/lib/feature-flags'

// Session 3 Step 5 — Full umbrella detail page with 5 sections:
//   1. Header (name, description, stats, Run Intelligence Scan)
//   2. Story arcs panel (with completeness indicator + next re-analysis)
//   3. One-offs panel
//   4. Cross-event outlet behavior (gated on 3+ analyses)
//   5. Manual observations (auto-save on blur)

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

interface ArcItem {
  id: string
  slug: string
  arcLabel: string
  headline: string
  arcImportance: string | null
  currentPhase: string
  completeness: 'complete' | 'partial' | 'first_wave_only' | 'incomplete'
  completedPhases: string[]
  nextScheduled: { targetPhase: string; scheduledFor: string } | null
  searchQuery: string
  storyClusterId: string | null
  createdAt: string
}

interface OneOffItem {
  id: string
  slug: string
  label: string
  headline: string
  primaryCategory: string | null
  arcPhaseAtCreation: string | null
  createdAt: string
}

interface ContentsResponse {
  arcs: ArcItem[]
  oneOffs: OneOffItem[]
}

interface OutletProfileItem {
  outletId: string
  outletName: string
  outletDomain: string
  tier: string
  politicalLean: string
  reliability: string
  analysesAppeared: number
  frameConsistency: number
  earlyMoverRate: number
  omissionConsistencyRate: number
  insufficientData: boolean
  computedAt: string
}

interface OutletProfilesResponse {
  thresholdMet: boolean
  profiles: OutletProfileItem[]
}

function formatCategory(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}
function formatPhase(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export default function UmbrellaDetailPage() {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) notFound()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [umbrella, setUmbrella] = useState<UmbrellaDetail | null>(null)
  const [contents, setContents] = useState<ContentsResponse | null>(null)
  const [profiles, setProfiles] = useState<OutletProfilesResponse | null>(null)
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesSavedAt, setNotesSavedAt] = useState<string | null>(null)
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchAll = useCallback(async () => {
    if (!id) return
    try {
      const [u, c, p, r] = await Promise.all([
        fetch(`/api/admin/umbrellas/${id}`).then(r => r.json()),
        fetch(`/api/admin/umbrellas/${id}/contents`).then(r => r.json()),
        fetch(`/api/admin/umbrellas/${id}/outlet-profiles`).then(r => r.json()),
        fetch(`/api/admin/umbrellas/${id}/intelligence-scan`).then(r => r.json()),
      ])
      setUmbrella(u.umbrella)
      setContents(c)
      setProfiles(p)
      setRecs(r)
      setNotesDraft(u.umbrella?.notes ?? '')
      setNotesSavedAt(u.umbrella?.updatedAt ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

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

  async function saveNotes(text: string) {
    if (!id) return
    try {
      const r = await fetch(`/api/admin/umbrellas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text }),
      })
      if (r.ok) setNotesSavedAt(new Date().toISOString())
    } catch {
      // Auto-save — surface error on next blur if persistent
    }
  }

  function handleNotesBlur() {
    if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current)
    saveNotes(notesDraft)
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

  const daysActive = umbrella.firstAnalysisAt
    ? Math.floor((Date.now() - new Date(umbrella.firstAnalysisAt).getTime()) / 86400000)
    : 0

  return (
    <div>
      <a href="/admin/signals/umbrellas" className="text-xs font-mono text-text-tertiary hover:text-text-primary">
        &larr; All Umbrellas
      </a>

      {/* ─────────────────── SECTION 1: HEADER ─────────────────── */}
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
          }}
        >
          <Stat label="Category" value={formatCategory(umbrella.signalCategory)} />
          <Stat label="Days Active" value={daysActive.toString()} />
          <Stat label="Total Analyses" value={umbrella.totalAnalyses.toString()} />
          <Stat label="Story Arcs" value={umbrella.storyArcCount.toString()} />
          <Stat label="One-Offs" value={umbrella.oneOffCount.toString()} />
          <Stat label="Scan Frequency" value={umbrella.scanFrequency.replace(/_/g, ' ')} />
        </div>
      </div>

      {/* ─────────── SECTION 1 (continued): RECOMMENDED TRIGGERS ─────────── */}
      <Card title="Recommended Triggers" subtitle={
        recs?.ranAt
          ? `Last scan: ${new Date(recs.ranAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
          : 'Haiku-suggested sub-events worth filing. Nothing auto-executes.'
      }
      actionButton={
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
      }>
        {scanError && <p style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>{scanError}</p>}

        {recs?.limitedData && (recs.recommendations.length > 0) && (
          <div style={{ display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 8px', background: 'var(--accent-amber)', color: '#0A0A0B', borderRadius: 2, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Early Signal — Limited Data ({umbrella.totalAnalyses}/5 analyses)
          </div>
        )}

        {!recs || recs.recommendations.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', padding: '16px 0' }}>
            {recs?.ranAt
              ? 'No recommendations from the last scan.'
              : 'No scan has been run yet. Click Run Intelligence Scan to generate recommendations.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recs.recommendations.map((r, idx) => <RecommendationRow key={idx} umbrellaId={id ?? ''} rec={r} />)}
          </div>
        )}
      </Card>

      {/* ─────────────────── SECTION 2: STORY ARCS ─────────────────── */}
      <Card title="Story Arcs" subtitle={`${contents?.arcs.length ?? 0} arcs under this umbrella`}>
        {!contents || contents.arcs.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>
            No story arcs yet. File a new_arc analysis from the admin form.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contents.arcs.map(arc => <ArcRow key={arc.id} arc={arc} umbrellaId={id ?? ''} />)}
          </div>
        )}
      </Card>

      {/* ─────────────────── SECTION 3: ONE-OFFS ─────────────────── */}
      <Card title="One-offs" subtitle={`${contents?.oneOffs.length ?? 0} umbrella-tagged analyses`}>
        {!contents || contents.oneOffs.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>
            No one-offs yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contents.oneOffs.map(o => <OneOffRow key={o.id} item={o} />)}
          </div>
        )}
      </Card>

      {/* ─────────── SECTION 4: CROSS-EVENT OUTLET BEHAVIOR ─────────── */}
      <Card title="Cross-event Outlet Behavior" subtitle="How outlets behave across multiple events under this umbrella">
        {!profiles?.thresholdMet ? (
          <div style={{
            padding: 16,
            border: '1px dashed var(--border-primary)',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-tertiary)',
          }}>
            Cross-event patterns require 3 analyses — currently at {umbrella.totalAnalyses} of 3
          </div>
        ) : profiles.profiles.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>
            No outlets have appeared in 2+ analyses under this umbrella yet.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10, borderBottom: '1px solid var(--border-primary)' }}>
                  <th style={{ padding: '8px 8px 8px 0' }}>Outlet</th>
                  <th style={{ padding: '8px' }}>Tier</th>
                  <th style={{ padding: '8px' }}>Appearances</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Frame Consistency</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Early Mover</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Omission Match</th>
                </tr>
              </thead>
              <tbody>
                {profiles.profiles.map(p => (
                  <tr key={p.outletId} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                    <td style={{ padding: '10px 8px 10px 0' }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.outletName}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{p.outletDomain}</div>
                    </td>
                    <td style={{ padding: '10px 8px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      {p.tier.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ color: 'var(--text-primary)' }}>{p.analysesAppeared}</div>
                      {p.insufficientData && (
                        <div style={{ display: 'inline-block', marginTop: 2, fontSize: 9, padding: '1px 5px', background: 'var(--accent-amber)', color: '#0A0A0B', borderRadius: 2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Insufficient
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: p.insufficientData ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                      {pct(p.frameConsistency)}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: p.insufficientData ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                      {pct(p.earlyMoverRate)}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: p.insufficientData ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                      {pct(p.omissionConsistencyRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─────────────────── SECTION 5: MANUAL OBSERVATIONS ─────────────────── */}
      <Card title="Manual Observations" subtitle="Cross-event narrative drift notes — feeds the internal case study library. Auto-saves on blur.">
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="e.g. BBC consistently reframes escalation coverage as humanitarian by the third day of each arc..."
          style={{
            width: '100%',
            minHeight: 140,
            padding: '10px 12px',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 3,
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            resize: 'vertical',
          }}
        />
        {notesSavedAt && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
            Last saved: {new Date(notesSavedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </Card>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-tertiary)', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: '14px', marginTop: '2px' }}>{value}</div>
    </div>
  )
}

function Card({
  title,
  subtitle,
  children,
  actionButton,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  actionButton?: React.ReactNode
}) {
  return (
    <div style={{
      marginTop: 24,
      padding: 20,
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-primary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            {title}
          </h3>
          {subtitle && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {actionButton}
      </div>
      {children}
    </div>
  )
}

function RecommendationRow({ umbrellaId, rec }: { umbrellaId: string; rec: Recommendation }) {
  const kindColor = rec.recommendation === 'story_arc' ? 'var(--accent-green)' : 'var(--accent-blue)'
  const params = new URLSearchParams()
  params.set('umbrella', umbrellaId)
  params.set('type', rec.recommendation === 'story_arc' ? 'new_arc' : 'umbrella_tagged')
  params.set('arcLabel', rec.suggestedLabel)
  if (rec.estimatedPhase) params.set('phase', rec.estimatedPhase)

  return (
    <div style={{ border: '1px solid var(--border-primary)', borderLeft: `3px solid ${kindColor}`, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
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
              {formatPhase(rec.estimatedPhase)}
            </span>
          )}
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {rec.rationale}
        </p>
      </div>
      <a href={`/admin?${params.toString()}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 10px', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: 3, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
        Trigger Analysis
      </a>
    </div>
  )
}

const COMPLETENESS_LABELS: Record<ArcItem['completeness'], { label: string; color: string }> = {
  complete:         { label: 'Complete',         color: 'var(--accent-green)' },
  partial:          { label: 'Partial',          color: 'var(--accent-blue)' },
  first_wave_only:  { label: 'First Wave Only',  color: 'var(--accent-amber)' },
  incomplete:       { label: 'Incomplete',       color: 'var(--accent-red)' },
}

function ArcRow({ arc, umbrellaId }: { arc: ArcItem; umbrellaId: string }) {
  const completeness = COMPLETENESS_LABELS[arc.completeness]
  const rerunParams = new URLSearchParams()
  rerunParams.set('umbrella', umbrellaId)
  rerunParams.set('type', 'arc_rerun')
  rerunParams.set('arc', arc.id)
  if (arc.nextScheduled) rerunParams.set('phase', arc.nextScheduled.targetPhase)
  if (arc.searchQuery) rerunParams.set('query', arc.searchQuery)

  return (
    <div style={{ border: '1px solid var(--border-primary)', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <a href={`/story/${arc.slug}`} style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
            {arc.arcLabel}
          </a>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', background: completeness.color, color: '#0A0A0B', borderRadius: 2, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {completeness.label}
          </span>
          {arc.arcImportance && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', background: 'var(--border-primary)', color: 'var(--text-secondary)', borderRadius: 2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {arc.arcImportance}
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
          Current: {formatPhase(arc.currentPhase)}
          {arc.completedPhases.length > 0 && ` · Completed: ${arc.completedPhases.map(formatPhase).join(', ')}`}
          {arc.nextScheduled && ` · Next ${formatPhase(arc.nextScheduled.targetPhase)}: ${new Date(arc.nextScheduled.scheduledFor).toLocaleString('en-US', { month: 'short', day: 'numeric' })}`}
        </div>
      </div>
      <a href={`/admin?${rerunParams.toString()}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 12px', background: 'var(--accent-green)', color: '#000', borderRadius: 3, textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
        Run re-analysis
      </a>
    </div>
  )
}

function OneOffRow({ item }: { item: OneOffItem }) {
  return (
    <div style={{ border: '1px solid var(--border-primary)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <a href={`/story/${item.slug}`} style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none', flex: 1, minWidth: 0 }}>
        {item.label}
      </a>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
        {item.primaryCategory && <span style={{ marginRight: 12 }}>{item.primaryCategory}</span>}
        {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    </div>
  )
}
