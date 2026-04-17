"use client"
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// Full umbrella detail view (5 sections: header, story arcs, one-offs, cross-event
// outlet behavior, manual observations) is built in Step 5. This is a minimal
// placeholder so Step 1's "Open →" link + post-create flow don't 404.

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

function formatCategory(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export default function UmbrellaDetailStub() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [umbrella, setUmbrella] = useState<UmbrellaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  }, [id])

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

      <div
        style={{
          padding: '24px',
          background: 'var(--bg-secondary)',
          border: '1px dashed var(--border-primary)',
          marginTop: '24px',
        }}
      >
        <p className="text-xs font-mono text-text-tertiary uppercase tracking-wider mb-2">Full Detail View</p>
        <p className="text-sm text-text-muted" style={{ fontFamily: 'var(--font-body)' }}>
          The full 5-section umbrella view — story arcs panel, one-offs panel, cross-event outlet behavior,
          manual observations, intelligence scan recommendations — ships in Step 5. Nested analyses, arc queue,
          and scan are wired up in Steps 2–4.
        </p>
      </div>
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
