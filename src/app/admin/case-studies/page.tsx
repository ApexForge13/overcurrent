"use client"
import { useState, useEffect, useCallback } from 'react'

interface CaseStudyListEntry {
  id: string
  headline: string
  signalType: string
  divergenceType: string
  storyPhaseAtDetection: string
  isPublishable: boolean
  storyClusterId: string
  umbrellaArcId: string | null
  rawSignalLayerId: string | null
  createdAt: string
  updatedAt: string
}

interface CaseStudyDetailEntry extends CaseStudyListEntry {
  fullDescription: string
  storyCluster: { id: string; clusterHeadline: string; currentPhase: string } | null
  umbrellaArc: { id: string; name: string } | null
  rawSignalLayer: {
    id: string
    signalType: string
    signalSource: string
    captureDate: string
  } | null
}

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  editorial_kill: 'text-accent-red border-accent-red',
  editorial_correction: 'text-accent-amber border-accent-amber',
  predictive_finding_silenced: 'text-accent-blue border-accent-blue',
  maritime_ais: 'text-accent-green border-accent-green',
  gdelt: 'text-accent-green border-accent-green',
  sec_filing: 'text-accent-green border-accent-green',
  aviation_adsb: 'text-accent-green border-accent-green',
}

const DIVERGENCE_LABEL: Record<string, string> = {
  narrative_contradicts_raw: 'narrative ≠ raw',
  narrative_omits_raw: 'narrative omits raw',
  raw_precedes_narrative: 'raw → narrative',
  raw_corroborates_narrative: 'raw + narrative',
}

export default function AdminCaseStudies() {
  const [entries, setEntries] = useState<CaseStudyListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSignalType, setFilterSignalType] = useState<string>('')
  const [filterPublishable, setFilterPublishable] = useState<string>('')
  const [selected, setSelected] = useState<CaseStudyDetailEntry | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [toggling, setToggling] = useState<Record<string, boolean>>({})

  const fetchList = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSignalType) params.set('signalType', filterSignalType)
    if (filterPublishable) params.set('isPublishable', filterPublishable)
    fetch(`/api/admin/case-studies?${params}`)
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filterSignalType, filterPublishable])

  useEffect(() => { fetchList() }, [fetchList])

  async function openDetail(id: string) {
    setDetailLoading(true)
    setSelected(null)
    try {
      const res = await fetch(`/api/admin/case-studies/${id}`)
      const data = await res.json()
      setSelected(data.entry ?? null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function togglePublishable(id: string, next: boolean) {
    setToggling((s) => ({ ...s, [id]: true }))
    try {
      await fetch(`/api/admin/case-studies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublishable: next }),
      })
      // Update both list + selected
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, isPublishable: next } : e)))
      if (selected?.id === id) setSelected({ ...selected, isPublishable: next })
    } finally {
      setToggling((s) => {
        const out = { ...s }
        delete out[id]
        return out
      })
    }
  }

  const counts = {
    total: entries.length,
    publishable: entries.filter((e) => e.isPublishable).length,
    kill: entries.filter((e) => e.signalType === 'editorial_kill').length,
    correction: entries.filter((e) => e.signalType === 'editorial_correction').length,
    silenced: entries.filter((e) => e.signalType === 'predictive_finding_silenced').length,
  }

  const distinctSignalTypes = Array.from(new Set(entries.map((e) => e.signalType))).sort()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-xl text-text-primary">── CASE STUDIES ────────────────</h2>
        <p className="text-xs text-text-muted font-mono mt-1">
          Internal evidence library. Auto-populated by quality-review verdicts (kill, edits) and
          admin-reviewed raw signals. Toggle <span className="text-accent-green">isPublishable</span> to
          mark an entry for external sharing.
        </p>
      </div>

      <div className="grid grid-cols-5 gap-3 text-xs font-mono">
        <div className="border border-border p-3">
          <div className="text-text-muted">TOTAL</div>
          <div className="text-text-primary text-2xl font-bold">{counts.total}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">PUBLISHABLE</div>
          <div className="text-accent-green text-2xl font-bold">{counts.publishable}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">KILLS</div>
          <div className="text-accent-red text-2xl font-bold">{counts.kill}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">CORRECTIONS</div>
          <div className="text-accent-amber text-2xl font-bold">{counts.correction}</div>
        </div>
        <div className="border border-border p-3">
          <div className="text-text-muted">SILENCED FINDINGS</div>
          <div className="text-accent-blue text-2xl font-bold">{counts.silenced}</div>
        </div>
      </div>

      <div className="flex gap-3 text-xs font-mono">
        <select
          value={filterSignalType}
          onChange={(e) => setFilterSignalType(e.target.value)}
          className="bg-transparent border border-border p-2 text-text-primary"
        >
          <option value="">all signalTypes</option>
          {distinctSignalTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filterPublishable}
          onChange={(e) => setFilterPublishable(e.target.value)}
          className="bg-transparent border border-border p-2 text-text-primary"
        >
          <option value="">all (publishable + draft)</option>
          <option value="true">publishable only</option>
          <option value="false">draft only</option>
        </select>
        <button
          onClick={() => { setFilterSignalType(''); setFilterPublishable('') }}
          className="border border-border p-2 text-text-muted hover:text-text-primary"
        >
          clear filters
        </button>
        <button
          onClick={fetchList}
          className="border border-border p-2 text-text-muted hover:text-text-primary ml-auto"
        >
          refresh
        </button>
      </div>

      {loading && <div className="text-text-muted font-mono text-sm">Loading…</div>}

      {!loading && entries.length === 0 && (
        <div className="text-text-muted font-mono text-sm py-8 text-center border border-border">
          No case studies match these filters. Run a quality review or have admin mark a raw signal
          to start populating.
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className={`border ${e.id === selected?.id ? 'border-accent-blue' : 'border-border'} p-3 font-mono text-xs`}
            >
              <div className="flex gap-3 items-start">
                <span className={`px-2 py-0.5 border ${SIGNAL_TYPE_COLORS[e.signalType] ?? 'text-text-muted border-border'}`}>
                  {e.signalType}
                </span>
                <span className="text-text-muted">
                  {DIVERGENCE_LABEL[e.divergenceType] ?? e.divergenceType} · phase={e.storyPhaseAtDetection}
                </span>
                <span className={`ml-auto ${e.isPublishable ? 'text-accent-green' : 'text-text-muted'}`}>
                  {e.isPublishable ? 'PUBLISHABLE' : 'draft'}
                </span>
              </div>
              <button
                onClick={() => openDetail(e.id)}
                className="text-left mt-2 text-text-primary text-sm hover:text-accent-blue"
              >
                {e.headline}
              </button>
              <div className="mt-2 text-text-muted text-[11px] flex gap-4">
                <span>id={e.id.substring(0, 12)}</span>
                <span>cluster={e.storyClusterId.substring(0, 12)}</span>
                {e.umbrellaArcId && <span>umbrella={e.umbrellaArcId.substring(0, 12)}</span>}
                {e.rawSignalLayerId && <span>raw={e.rawSignalLayerId.substring(0, 12)}</span>}
                <span>created={new Date(e.createdAt).toISOString().split('T')[0]}</span>
                <button
                  onClick={() => togglePublishable(e.id, !e.isPublishable)}
                  disabled={!!toggling[e.id]}
                  className={`ml-auto px-2 py-0.5 border ${
                    e.isPublishable
                      ? 'text-accent-amber border-accent-amber hover:bg-accent-amber/10'
                      : 'text-accent-green border-accent-green hover:bg-accent-green/10'
                  } disabled:opacity-50`}
                >
                  {toggling[e.id]
                    ? '...'
                    : e.isPublishable
                      ? 'unpublish'
                      : 'mark publishable'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(detailLoading || selected) && (
        <div className="border border-accent-blue p-4 mt-6 space-y-3">
          {detailLoading && <div className="text-text-muted font-mono text-xs">Loading detail…</div>}
          {selected && (
            <>
              <div className="flex justify-between items-start">
                <div className="font-display font-bold text-lg text-text-primary">
                  {selected.headline}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-text-muted hover:text-text-primary text-xs font-mono"
                >
                  close
                </button>
              </div>

              <div className="text-xs font-mono text-text-muted flex gap-4 flex-wrap">
                <span>id={selected.id}</span>
                <span>signalType={selected.signalType}</span>
                <span>divergence={selected.divergenceType}</span>
                <span>phase={selected.storyPhaseAtDetection}</span>
                <span className={selected.isPublishable ? 'text-accent-green' : ''}>
                  {selected.isPublishable ? 'PUBLISHABLE' : 'draft'}
                </span>
              </div>

              <div className="text-xs font-mono text-text-muted">
                {selected.storyCluster && (
                  <div>cluster: {selected.storyCluster.clusterHeadline} <span className="text-text-secondary">(phase={selected.storyCluster.currentPhase})</span></div>
                )}
                {selected.umbrellaArc && <div>umbrella: {selected.umbrellaArc.name}</div>}
                {selected.rawSignalLayer && (
                  <div>raw signal: {selected.rawSignalLayer.signalType} via {selected.rawSignalLayer.signalSource} ({new Date(selected.rawSignalLayer.captureDate).toISOString().split('T')[0]})</div>
                )}
                <div>created: {new Date(selected.createdAt).toISOString()}</div>
                <div>updated: {new Date(selected.updatedAt).toISOString()}</div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => togglePublishable(selected.id, !selected.isPublishable)}
                  disabled={!!toggling[selected.id]}
                  className={`px-3 py-1 border ${
                    selected.isPublishable
                      ? 'text-accent-amber border-accent-amber hover:bg-accent-amber/10'
                      : 'text-accent-green border-accent-green hover:bg-accent-green/10'
                  } font-mono text-xs disabled:opacity-50`}
                >
                  {toggling[selected.id]
                    ? 'updating…'
                    : selected.isPublishable
                      ? 'Unpublish (move back to draft)'
                      : 'Mark publishable (mark for external sharing)'}
                </button>
              </div>

              <pre className="whitespace-pre-wrap text-text-secondary text-sm font-mono border-t border-border pt-3 leading-relaxed">
{selected.fullDescription}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
