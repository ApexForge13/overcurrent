"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'

// ── Types mirrored from server validation (kept inline to avoid server-only imports) ──
const ANALYSIS_TYPES = ['standalone', 'umbrella_tagged', 'new_arc', 'arc_rerun'] as const
type AnalysisType = (typeof ANALYSIS_TYPES)[number]

const STORY_PHASES = ['first_wave', 'development', 'consolidation', 'tail'] as const
type StoryPhase = (typeof STORY_PHASES)[number]

const ARC_IMPORTANCES = ['core', 'reference'] as const
type ArcImportance = (typeof ARC_IMPORTANCES)[number]

interface UmbrellaOption {
  id: string
  name: string
  signalCategory: string
  totalAnalyses: number
  storyArcCount: number
}

interface ArcOption {
  id: string
  arcLabel: string
  headline: string
  searchQuery: string
  currentPhase: StoryPhase
  totalAnalysesRun: number
  recommendedPhase: StoryPhase
  hoursElapsed: number
}

type Mode = 'verify' | 'undercurrent'

interface AnalyzeFormProps {
  /** Called when a started analysis reports a fresh review-status story. */
  onStoryReady: () => void
}

const RAILWAY_BASE = 'https://overcurrent-production.up.railway.app'

function formatPhase(p: string): string {
  return p
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function AnalyzeForm({ onStoryReady }: AnalyzeFormProps) {
  // ── Form state ──
  const [mode, setMode] = useState<Mode>('verify')
  const [query, setQuery] = useState('')
  const [umbrellaId, setUmbrellaId] = useState<string>('') // empty = None
  const [umbrellaSearch, setUmbrellaSearch] = useState('')
  const [showUmbrellaDropdown, setShowUmbrellaDropdown] = useState(false)
  const [analysisType, setAnalysisType] = useState<AnalysisType>('standalone')
  const [arcLabel, setArcLabel] = useState('')
  const [arcImportance, setArcImportance] = useState<ArcImportance>('core')
  const [arcRerunTargetStoryId, setArcRerunTargetStoryId] = useState<string>('')
  const [arcPhaseAtCreation, setArcPhaseAtCreation] = useState<StoryPhase | ''>('')
  // Tracks whether the query was populated by arc auto-fill (vs. typed by the
  // analyst). Clears on user edit so we don't keep overwriting their changes.
  const [queryAutoFilledFromArc, setQueryAutoFilledFromArc] = useState(false)

  // ── Data fetched from API ──
  const [umbrellas, setUmbrellas] = useState<UmbrellaOption[]>([])
  const [arcs, setArcs] = useState<ArcOption[]>([])
  const [loadingArcs, setLoadingArcs] = useState(false)

  // ── Submission state ──
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  // Status starts empty on both server and client to avoid hydration mismatch.
  // Saved status is restored from localStorage in an effect after mount.
  const [status, setStatus] = useState<string>('')

  // ── Restore saved analysis status from localStorage after mount ──
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('oc_analysis') || '{}')
      if (saved.msg && !saved.running) {
        setStatus(saved.msg)
      } else if (saved.msg && saved.running && Date.now() - saved.ts < 600_000) {
        setStatus(
          `${saved.msg} (pipeline was running for "${saved.query}" — may still be processing on Railway)`,
        )
      }
    } catch {}
  }, [])

  // ── Load umbrellas on mount ──
  useEffect(() => {
    fetch('/api/admin/umbrellas?status=active&limit=200')
      .then((r) => r.json())
      .then((data) => setUmbrellas(data.umbrellas ?? []))
      .catch(() => setUmbrellas([]))
  }, [])

  // ── Apply URL params for deep-linking from arc-queue / umbrella detail (Step 3/5) ──
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const umb = params.get('umbrella')
    const type = params.get('type')
    const arc = params.get('arc')
    const phase = params.get('phase')
    const qparam = params.get('query')
    if (umb) setUmbrellaId(umb)
    if (type && (ANALYSIS_TYPES as readonly string[]).includes(type)) setAnalysisType(type as AnalysisType)
    if (arc) setArcRerunTargetStoryId(arc)
    if (phase && (STORY_PHASES as readonly string[]).includes(phase)) setArcPhaseAtCreation(phase as StoryPhase)
    if (qparam) {
      setQuery(qparam)
      setQueryAutoFilledFromArc(true)
    }
  }, [])

  // ── Load arcs for selected umbrella (only if arc_rerun might be used) ──
  useEffect(() => {
    if (!umbrellaId) {
      setArcs([])
      return
    }
    setLoadingArcs(true)
    fetch(`/api/admin/umbrellas/${umbrellaId}/arcs`)
      .then((r) => r.json())
      .then((data) => setArcs(data.arcs ?? []))
      .catch(() => setArcs([]))
      .finally(() => setLoadingArcs(false))
  }, [umbrellaId])

  // ── Reset conditional fields when umbrella or analysisType changes ──
  useEffect(() => {
    if (!umbrellaId) {
      // None selected → force standalone
      setAnalysisType('standalone')
    }
  }, [umbrellaId])

  useEffect(() => {
    if (analysisType !== 'new_arc') {
      setArcLabel('')
      setArcImportance('core')
    }
    if (analysisType !== 'arc_rerun') {
      setArcRerunTargetStoryId('')
    }
    if (analysisType !== 'arc_rerun' && analysisType !== 'new_arc') {
      setArcPhaseAtCreation('')
    }
  }, [analysisType])

  // ── Auto-prefill recommended phase when arc_rerun arc is selected ──
  const selectedArc = useMemo(
    () => arcs.find((a) => a.id === arcRerunTargetStoryId),
    [arcs, arcRerunTargetStoryId],
  )
  useEffect(() => {
    if (analysisType === 'arc_rerun' && selectedArc && !arcPhaseAtCreation) {
      setArcPhaseAtCreation(selectedArc.recommendedPhase)
    }
  }, [analysisType, selectedArc, arcPhaseAtCreation])

  // ── Auto-fill query from initiating arc when arc_rerun arc is selected ──
  // Only fills if the query field is empty or was previously auto-filled.
  // Never overwrites text the analyst typed themselves.
  useEffect(() => {
    if (analysisType !== 'arc_rerun') return
    if (!selectedArc?.searchQuery) return
    if (query.trim() === '' || queryAutoFilledFromArc) {
      setQuery(selectedArc.searchQuery)
      setQueryAutoFilledFromArc(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisType, selectedArc])

  // Clear the auto-filled flag when analysisType changes away from arc_rerun
  useEffect(() => {
    if (analysisType !== 'arc_rerun') setQueryAutoFilledFromArc(false)
  }, [analysisType])

  // ── Filtered umbrella list for searchable dropdown ──
  const selectedUmbrella = useMemo(() => umbrellas.find((u) => u.id === umbrellaId), [umbrellas, umbrellaId])
  const filteredUmbrellas = useMemo(() => {
    const q = umbrellaSearch.trim().toLowerCase()
    const sorted = [...umbrellas].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return sorted
    return sorted.filter((u) => u.name.toLowerCase().includes(q))
  }, [umbrellas, umbrellaSearch])

  // ── Submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim() || isAnalyzing) return

    // Confirmation prompt for standalone-with-umbrella edge case
    if (umbrellaId && analysisType === 'standalone') {
      const ok = window.confirm(
        'This will not contribute to umbrella fingerprinting. Use umbrella-tagged one-off instead to contribute signal. Proceed as standalone?',
      )
      if (!ok) return
    }

    // Validate required fields per analysisType
    if (analysisType === 'new_arc' && !arcLabel.trim()) {
      setStatus('Error: Arc label is required for a new story arc')
      return
    }
    if (analysisType === 'arc_rerun' && !arcRerunTargetStoryId) {
      setStatus('Error: Select the existing arc to re-run')
      return
    }

    setIsAnalyzing(true)
    const statusUpdate = (msg: string, running = true) => {
      setStatus(msg)
      try {
        localStorage.setItem(
          'oc_analysis',
          JSON.stringify({ msg, running, ts: Date.now(), query: query.trim() }),
        )
      } catch {}
    }
    statusUpdate('Starting analysis...')

    const endpoint =
      mode === 'verify' ? `${RAILWAY_BASE}/analyze` : `${RAILWAY_BASE}/undercurrent`

    const body: Record<string, unknown> = { query: query.trim() }
    if (mode === 'verify') {
      // Only verify endpoint accepts arc fields; undercurrent ignores them
      if (umbrellaId) body.umbrellaArcId = umbrellaId
      if (analysisType) body.analysisType = analysisType
      if (arcLabel.trim()) body.arcLabel = arcLabel.trim()
      if (analysisType === 'new_arc') body.arcImportance = arcImportance
      if (arcPhaseAtCreation) body.arcPhaseAtCreation = arcPhaseAtCreation
      if (analysisType === 'arc_rerun') body.arcRerunTargetStoryId = arcRerunTargetStoryId
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Railway returned ${response.status}: ${response.statusText}`)
      if (!response.body) throw new Error('No stream body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            statusUpdate(data.message || data.phase || '')
            if (data.phase === 'complete') {
              finished = true
              setIsAnalyzing(false)
              setQuery('')
              statusUpdate('Complete — story is in review below', false)
              onStoryReady()
            }
            if (data.phase === 'error') {
              finished = true
              setIsAnalyzing(false)
              statusUpdate(`Error: ${data.message}`, false)
            }
          } catch {}
        }
      }
      if (!finished) {
        setIsAnalyzing(false)
        statusUpdate(
          'Stream ended unexpectedly — pipeline may have crashed. Check Railway logs.',
          false,
        )
      }
    } catch (err) {
      setIsAnalyzing(false)
      const msg = err instanceof Error ? err.message : 'connection lost'
      // HTTP/2 SSE streams on Railway sometimes drop mid-analysis even though
      // the pipeline keeps running server-side. Tell the operator truthfully.
      const looksLikeStreamDrop =
        msg.includes('network') || msg.includes('HTTP2') || msg.includes('fetch')
      if (looksLikeStreamDrop) {
        statusUpdate(
          'Stream connection dropped — the pipeline is still running on Railway. Check the review list in 15-20 minutes, or tail the Railway logs.',
          false,
        )
      } else {
        statusUpdate(`Analysis failed: ${msg}`, false)
      }
    }
  }

  const analysisTypeOptions = useMemo(() => {
    if (!umbrellaId) {
      return [{ value: 'standalone' as const, label: 'Standalone one-off', helper: 'No umbrella, no re-run schedule.' }]
    }
    return [
      {
        value: 'umbrella_tagged' as const,
        label: 'Umbrella-tagged one-off',
        helper: 'Single analysis that contributes to cross-event fingerprinting. No re-run schedule.',
      },
      {
        value: 'new_arc' as const,
        label: 'New story arc',
        helper: 'Bounded event that will be re-analyzed on a phase schedule.',
      },
      {
        value: 'arc_rerun' as const,
        label: 'Re-run existing story arc',
        helper: 'Re-analyze an existing arc for its next phase.',
      },
      {
        value: 'standalone' as const,
        label: 'Standalone one-off (under umbrella)',
        helper: 'Filed under the umbrella for context only. Does NOT contribute to fingerprinting.',
      },
    ]
  }, [umbrellaId])

  return (
    <div
      className="p-5"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
    >
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h3
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
          }}
        >
          New Analysis
        </h3>
        <button
          onClick={() => setMode('verify')}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            padding: '2px 8px',
            color: mode === 'verify' ? 'var(--accent-green)' : 'var(--text-tertiary)',
            border: mode === 'verify' ? '1px solid var(--accent-green)' : '1px solid transparent',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          verify
        </button>
        <button
          onClick={() => setMode('undercurrent')}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            padding: '2px 8px',
            color: mode === 'undercurrent' ? 'var(--accent-purple)' : 'var(--text-tertiary)',
            border: mode === 'undercurrent' ? '1px solid var(--accent-purple)' : '1px solid transparent',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          undercurrent
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Umbrella selector (verify only) */}
        {mode === 'verify' && (
          <div>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '4px',
              }}
            >
              Umbrella
            </label>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowUmbrellaDropdown((s) => !s)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontFamily: 'var(--font-body)',
                  fontSize: '13px',
                  background: 'var(--bg-primary)',
                  color: selectedUmbrella ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  border: '1px solid var(--border-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  {selectedUmbrella ? (
                    <>
                      {selectedUmbrella.name}
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                          marginLeft: '8px',
                        }}
                      >
                        — {selectedUmbrella.totalAnalyses} analyses
                      </span>
                    </>
                  ) : (
                    'None (standalone only)'
                  )}
                </span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>▾</span>
              </button>
              {showUmbrellaDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '2px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    maxHeight: '280px',
                    overflowY: 'auto',
                    zIndex: 10,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Search umbrellas..."
                    value={umbrellaSearch}
                    onChange={(e) => setUmbrellaSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontFamily: 'var(--font-body)',
                      fontSize: '12px',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: 'none',
                      borderBottom: '1px solid var(--border-primary)',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setUmbrellaId('')
                      setShowUmbrellaDropdown(false)
                      setUmbrellaSearch('')
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: umbrellaId === '' ? 'var(--accent-green)' : 'var(--text-secondary)',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    None (standalone only)
                  </button>
                  {filteredUmbrellas.length === 0 ? (
                    <p
                      style={{
                        padding: '10px 12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      No umbrellas match "{umbrellaSearch}"
                    </p>
                  ) : (
                    filteredUmbrellas.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setUmbrellaId(u.id)
                          setShowUmbrellaDropdown(false)
                          setUmbrellaSearch('')
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          fontFamily: 'var(--font-body)',
                          fontSize: '13px',
                          color: umbrellaId === u.id ? 'var(--accent-green)' : 'var(--text-primary)',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid var(--border-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        <div>{u.name}</div>
                        <div
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            color: 'var(--text-tertiary)',
                            marginTop: '2px',
                          }}
                        >
                          {u.signalCategory.replace(/_/g, ' ')} · {u.totalAnalyses} analyses · {u.storyArcCount} arcs
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analysis type selector (verify only) */}
        {mode === 'verify' && (
          <div>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '4px',
              }}
            >
              Analysis Type
            </label>
            <div className="flex flex-col gap-1">
              {analysisTypeOptions.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    background: analysisType === opt.value ? 'var(--bg-primary)' : 'transparent',
                    border:
                      analysisType === opt.value
                        ? '1px solid var(--accent-green)'
                        : '1px solid var(--border-primary)',
                  }}
                >
                  <input
                    type="radio"
                    name="analysisType"
                    value={opt.value}
                    checked={analysisType === opt.value}
                    onChange={() => setAnalysisType(opt.value)}
                    style={{ accentColor: 'var(--accent-green)', marginTop: '2px' }}
                  />
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)' }}>
                      {opt.label}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        marginTop: '2px',
                      }}
                    >
                      {opt.helper}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* new_arc fields */}
        {mode === 'verify' && analysisType === 'new_arc' && (
          <div className="flex flex-col gap-3 p-3" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '4px',
                }}
              >
                Arc Label
              </label>
              <input
                type="text"
                value={arcLabel}
                onChange={(e) => setArcLabel(e.target.value)}
                placeholder='e.g. "US-Iran Naval Blockade"'
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontFamily: 'var(--font-body)',
                  fontSize: '13px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  outline: 'none',
                }}
              />
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Short specific descriptor. Not just "Iran".
              </p>
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '4px',
                }}
              >
                Arc Importance
              </label>
              <div className="flex gap-2">
                {ARC_IMPORTANCES.map((imp) => (
                  <button
                    key={imp}
                    type="button"
                    onClick={() => setArcImportance(imp)}
                    style={{
                      padding: '6px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: arcImportance === imp ? 'var(--accent-green)' : 'var(--text-tertiary)',
                      border: arcImportance === imp ? '1px solid var(--accent-green)' : '1px solid var(--border-primary)',
                      background: 'transparent',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {imp === 'core' ? 'Core (schedule + reminders)' : 'Reference (fingerprinting only)'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* arc_rerun fields */}
        {mode === 'verify' && analysisType === 'arc_rerun' && (
          <div className="flex flex-col gap-3 p-3" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '4px',
                }}
              >
                Existing Arc
              </label>
              {loadingArcs ? (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  Loading arcs...
                </p>
              ) : arcs.length === 0 ? (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  No active core arcs under this umbrella. Create a new arc first.
                </p>
              ) : (
                <select
                  value={arcRerunTargetStoryId}
                  onChange={(e) => setArcRerunTargetStoryId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  <option value="">— Select arc —</option>
                  {arcs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.arcLabel} · {a.totalAnalysesRun} prior · current {formatPhase(a.currentPhase)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {selectedArc && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '4px',
                  }}
                >
                  Target Phase (recommended: {formatPhase(selectedArc.recommendedPhase)})
                </label>
                <div className="flex gap-2 flex-wrap">
                  {STORY_PHASES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setArcPhaseAtCreation(p)}
                      style={{
                        padding: '5px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: arcPhaseAtCreation === p ? 'var(--accent-green)' : 'var(--text-tertiary)',
                        border:
                          arcPhaseAtCreation === p
                            ? '1px solid var(--accent-green)'
                            : p === selectedArc.recommendedPhase
                            ? '1px dashed var(--accent-amber)'
                            : '1px solid var(--border-primary)',
                        background: 'transparent',
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {formatPhase(p)}
                      {p === selectedArc.recommendedPhase && (
                        <span style={{ color: 'var(--accent-amber)', marginLeft: '4px' }}>●</span>
                      )}
                    </button>
                  ))}
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Arc started {selectedArc.hoursElapsed}h ago. Override phase only if you have a reason.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Query + submit */}
        <div>
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (queryAutoFilledFromArc) setQueryAutoFilledFromArc(false)
              }}
              placeholder={
                mode === 'verify' ? 'Enter a story to analyze...' : 'Enter the dominant story...'
              }
              disabled={isAnalyzing}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontFamily: 'var(--font-body)',
                fontSize: '13px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: queryAutoFilledFromArc
                  ? '1px dashed var(--accent-teal)'
                  : '1px solid var(--border-primary)',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={isAnalyzing || !query.trim()}
              style={{
                padding: '8px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                background: 'transparent',
                cursor: isAnalyzing ? 'wait' : 'pointer',
                opacity: isAnalyzing ? 0.5 : 1,
              }}
            >
              {isAnalyzing ? 'analyzing...' : 'analyze'}
            </button>
          </div>
          {queryAutoFilledFromArc && (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--accent-teal)',
                marginTop: '4px',
              }}
            >
              Auto-filled from arc — edit to refine focus (e.g. "day 3 reactions...")
            </p>
          )}
        </div>

        {status && (
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: isAnalyzing
                ? 'var(--accent-amber)'
                : status.includes('Error') || status.includes('failed')
                ? 'var(--accent-red)'
                : 'var(--accent-green)',
            }}
          >
            {status}
          </p>
        )}
      </form>
    </div>
  )
}
