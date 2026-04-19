"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'

// ── Constants mirrored from src/lib/umbrella-validation.ts ──
// Kept inline (not imported) to avoid pulling server-only deps into the client bundle.
const SIGNAL_CATEGORIES = [
  'trade_dispute',
  'military_conflict',
  'election_coverage',
  'corporate_scandal',
  'political_scandal',
  'diplomatic_negotiation',
  'civil_unrest',
  'economic_policy',
  'environmental_event',
] as const
type SignalCategory = (typeof SIGNAL_CATEGORIES)[number]

const SCAN_FREQUENCIES = ['manual', 'daily', 'every_48_hours', 'weekly'] as const
type ScanFrequency = (typeof SCAN_FREQUENCIES)[number]

interface Umbrella {
  id: string
  name: string
  description: string | null
  status: 'active' | 'archived'
  signalCategory: SignalCategory
  scanFrequency: ScanFrequency
  firstAnalysisAt: string | null
  lastAnalysisAt: string | null
  totalAnalyses: number
  storyArcCount: number
  oneOffCount: number
  intelligenceScanLastRunAt: string | null
  createdAt: string
  updatedAt: string
}

function daysActive(u: Umbrella): number {
  const start = u.firstAnalysisAt ?? u.createdAt
  if (!start) return 0
  const ms = Date.now() - new Date(start).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function formatCategory(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function formatFrequency(f: string): string {
  if (f === 'every_48_hours') return 'Every 48h'
  return f.charAt(0).toUpperCase() + f.slice(1)
}

export default function UmbrellasPage() {
  const [umbrellas, setUmbrellas] = useState<Umbrella[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'active' | 'archived' | 'all'>('active')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [scanStatus, setScanStatus] = useState<Record<string, string>>({})

  const fetchUmbrellas = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== 'all') params.set('status', filterStatus)
      if (filterCategory) params.set('category', filterCategory)
      if (searchQuery.trim()) params.set('q', searchQuery.trim())
      params.set('limit', '100')

      const resp = await fetch(`/api/admin/umbrellas?${params}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setUmbrellas(data.umbrellas ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load umbrellas')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterCategory, searchQuery])

  useEffect(() => {
    fetchUmbrellas()
  }, [fetchUmbrellas])

  async function archiveUmbrella(id: string) {
    if (!confirm('Archive this umbrella? Nested analyses are preserved — the umbrella simply stops appearing in active lists.')) {
      return
    }
    setBusyId(id)
    try {
      const resp = await fetch(`/api/admin/umbrellas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      await fetchUmbrellas()
    } catch (err) {
      alert(`Failed to archive: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusyId(null)
    }
  }

  async function unarchiveUmbrella(id: string) {
    setBusyId(id)
    try {
      const resp = await fetch(`/api/admin/umbrellas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      await fetchUmbrellas()
    } catch (err) {
      alert(`Failed to unarchive: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleRunScan(id: string) {
    setScanStatus((prev) => ({ ...prev, [id]: 'Running scan…' }))
    try {
      const r = await fetch(`/api/admin/umbrellas/${id}/intelligence-scan`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      const n = Array.isArray(data.recommendations) ? data.recommendations.length : 0
      setScanStatus((prev) => ({ ...prev, [id]: `${n} recommendation${n === 1 ? '' : 's'}` }))
    } catch (e) {
      setScanStatus((prev) => ({
        ...prev,
        [id]: `Error: ${e instanceof Error ? e.message : 'unknown'}`,
      }))
    }
    setTimeout(() => {
      setScanStatus((prev) => {
        const { [id]: _removed, ...rest } = prev
        return rest
      })
    }, 5000)
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const u of umbrellas) {
      counts[u.signalCategory] = (counts[u.signalCategory] ?? 0) + 1
    }
    return counts
  }, [umbrellas])

  return (
    <div>
      {/* Header + breadcrumbs */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-xl">Umbrella Arcs</h2>
          <p className="text-xs font-mono text-text-muted mt-1">
            Named containers for related story arcs + one-offs. Cross-event fingerprinting requires 3+ nested analyses.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-mono rounded bg-accent-green/20 text-accent-green hover:bg-accent-green/30 transition-colors"
        >
          + Create Umbrella
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1">
            {(['active', 'archived', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  padding: '4px 10px',
                  color: filterStatus === s ? 'var(--accent-green)' : 'var(--text-tertiary)',
                  border:
                    filterStatus === s ? '1px solid var(--accent-green)' : '1px solid var(--border-primary)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{
              padding: '4px 8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <option value="">All categories</option>
            {SIGNAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {formatCategory(c)} {categoryCounts[c] ? `(${categoryCounts[c]})` : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name..."
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '4px 10px',
              fontFamily: 'var(--font-body)',
              fontSize: '13px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Cards grid */}
      {loading ? (
        <p className="text-sm font-mono text-text-muted">Loading...</p>
      ) : error ? (
        <p className="text-sm font-mono text-accent-red">Error: {error}</p>
      ) : umbrellas.length === 0 ? (
        <div className="text-center py-16" style={{ border: '1px dashed var(--border-primary)' }}>
          <p className="font-mono text-sm text-text-muted mb-3">
            {filterStatus === 'archived'
              ? 'No archived umbrellas.'
              : 'No umbrellas yet.'}
          </p>
          {filterStatus !== 'archived' && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs font-mono text-accent-green hover:underline"
            >
              Create the first one →
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {umbrellas.map((u) => (
            <UmbrellaCard
              key={u.id}
              umbrella={u}
              busy={busyId === u.id}
              scanStatus={scanStatus[u.id]}
              onArchive={() => archiveUmbrella(u.id)}
              onUnarchive={() => unarchiveUmbrella(u.id)}
              onRunScan={() => handleRunScan(u.id)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateUmbrellaModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            fetchUmbrellas()
          }}
        />
      )}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────
function UmbrellaCard({
  umbrella: u,
  busy,
  scanStatus,
  onArchive,
  onUnarchive,
  onRunScan,
}: {
  umbrella: Umbrella
  busy: boolean
  scanStatus: string | undefined
  onArchive: () => void
  onUnarchive: () => void
  onRunScan: () => void
}) {
  const days = daysActive(u)
  const archived = u.status === 'archived'

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--bg-secondary)',
        border: archived ? '1px solid var(--border-primary)' : '1px solid var(--border-primary)',
        opacity: archived ? 0.55 : 1,
        padding: '16px 16px 12px 16px',
      }}
    >
      {/* Folder tab — small visual affordance at the top-left */}
      <div
        style={{
          position: 'absolute',
          top: '-1px',
          left: '12px',
          width: '48px',
          height: '6px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderBottom: 'none',
        }}
      />

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <a
            href={`/admin/signals/umbrellas/${u.id}`}
            className="font-display font-bold text-text-primary hover:text-accent-green transition-colors"
            style={{ fontSize: '16px', lineHeight: 1.25 }}
          >
            {u.name}
          </a>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: archived ? 'var(--text-tertiary)' : 'var(--accent-green)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              marginTop: '2px',
            }}
          >
            {u.status}
          </span>
        </div>
        {u.description && (
          <p
            className="text-xs text-text-muted mt-1 line-clamp-2"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {u.description}
          </p>
        )}
      </div>

      {/* Metadata row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          marginBottom: '10px',
          paddingBottom: '10px',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Category</div>
          <div>{formatCategory(u.signalCategory)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Scan</div>
          <div>{formatFrequency(u.scanFrequency)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Analyses</div>
          <div>
            {u.totalAnalyses} total
            {u.totalAnalyses > 0 && (
              <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                ({u.storyArcCount} arc / {u.oneOffCount} one-off)
              </span>
            )}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Active</div>
          <div>{days} {days === 1 ? 'day' : 'days'}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onRunScan}
          disabled={busy || archived}
          className="px-2.5 py-1 text-xs font-mono rounded bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30 transition-colors disabled:opacity-40"
        >
          Run Intelligence Scan
        </button>
        <a
          href={`/admin/signals/umbrellas/${u.id}`}
          className="px-2.5 py-1 text-xs font-mono rounded bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors"
        >
          Open →
        </a>
        {archived ? (
          <button
            onClick={onUnarchive}
            disabled={busy}
            className="ml-auto px-2.5 py-1 text-xs font-mono rounded bg-accent-amber/20 text-accent-amber hover:bg-accent-amber/30 transition-colors disabled:opacity-40"
          >
            Restore
          </button>
        ) : (
          <button
            onClick={onArchive}
            disabled={busy}
            className="ml-auto px-2.5 py-1 text-xs font-mono rounded text-text-tertiary hover:text-accent-red transition-colors disabled:opacity-40"
            style={{ border: '1px solid var(--border-primary)' }}
          >
            Archive
          </button>
        )}
      </div>

      {scanStatus && (
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--accent-amber)',
            marginTop: '8px',
          }}
        >
          {scanStatus}
        </p>
      )}
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────
function CreateUmbrellaModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [signalCategory, setSignalCategory] = useState<SignalCategory | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!name.trim()) return setError('Name is required')
    if (!signalCategory) return setError('Signal category is required')

    setSubmitting(true)
    try {
      const resp = await fetch('/api/admin/umbrellas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          signalCategory,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
        throw new Error(data.error || `HTTP ${resp.status}`)
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          padding: '24px',
        }}
      >
        <h3 className="font-display font-bold text-lg mb-1">Create Umbrella Arc</h3>
        <p className="text-xs font-mono text-text-muted mb-5">
          A named folder for related story arcs + one-offs. Never analyzed directly.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-mono text-text-tertiary uppercase tracking-wider">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. US-Iran Escalation 2026"
              autoFocus
              maxLength={200}
              style={{
                padding: '8px 12px',
                fontFamily: 'var(--font-body)',
                fontSize: '14px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                outline: 'none',
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-mono text-text-tertiary uppercase tracking-wider">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What narrative does this umbrella track?"
              rows={3}
              style={{
                padding: '8px 12px',
                fontFamily: 'var(--font-body)',
                fontSize: '13px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-mono text-text-tertiary uppercase tracking-wider">Signal Category</span>
            <select
              value={signalCategory}
              onChange={(e) => setSignalCategory(e.target.value as SignalCategory)}
              style={{
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <option value="">— Select —</option>
              {SIGNAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {formatCategory(c)}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-red)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-mono text-text-tertiary hover:text-text-primary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-mono rounded bg-accent-green/20 text-accent-green hover:bg-accent-green/30 transition-colors disabled:opacity-40"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
