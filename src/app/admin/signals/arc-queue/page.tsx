"use client"
import { useState, useEffect, useCallback } from 'react'

// ── Types mirror the shape of /api/admin/arc-schedules and /api/admin/arc-queue-stats ──

interface ScheduleItem {
  id: string
  targetPhase: 'first_wave' | 'development' | 'consolidation' | 'tail'
  scheduledFor: string
  daysUntilDue: number
  daysOverdue: number
  umbrella: {
    id: string
    name: string
    signalCategory: string
  } | null
  arc: {
    storyId: string
    arcLabel: string | null
    currentPhase: string | null
    headline: string | null
    searchQuery: string
    storyClusterId: string | null
  } | null
}

interface SchedulesResponse {
  overdue: ScheduleItem[]
  dueToday: ScheduleItem[]
  upcoming: ScheduleItem[]
  counts: { overdue: number; dueToday: number; upcoming: number }
  now: string
}

interface StatsResponse {
  month: { start: string; label: string }
  total: number
  storyArc: { count: number; pct: number }
  umbrellaTagged: { count: number; pct: number }
  standalone: { count: number; pct: number }
  target: {
    arcAndTaggedPct: number
    standalonePct: number
    actual: number
    status: 'above' | 'on' | 'below'
  }
}

interface AdvancementItem {
  scanId: string
  storyArcId: string
  umbrellaArcId: string
  arcLabel: string
  umbrellaName: string
  confidenceLevel: 'medium' | 'high'
  rationale: string | null
  scannedAt: string
  searchQuery: string
  arcPhaseAtCreation: string | null
}

interface AdvancementsResponse {
  items: AdvancementItem[]
  count: number
}

const PHASE_LABELS: Record<string, string> = {
  first_wave: 'First Wave',
  development: 'Development',
  consolidation: 'Consolidation',
  tail: 'Tail',
}

const PHASE_ORDER: Record<string, string> = {
  first_wave: 'Development',
  development: 'Consolidation',
  consolidation: 'Tail',
  tail: 'Tail (manual extend)',
}

function formatCategory(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ArcQueuePage() {
  const [schedules, setSchedules] = useState<SchedulesResponse | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [advancements, setAdvancements] = useState<AdvancementsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skipModal, setSkipModal] = useState<ScheduleItem | null>(null)
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [schedRes, statsRes, advRes] = await Promise.all([
        fetch('/api/admin/arc-schedules'),
        fetch('/api/admin/arc-queue-stats'),
        fetch('/api/admin/arc-advancement-scans'),
      ])
      if (!schedRes.ok) throw new Error(`schedules: ${schedRes.status}`)
      if (!statsRes.ok) throw new Error(`stats: ${statsRes.status}`)
      // advancement is optional — don't fail everything if it 500s
      const schedData: SchedulesResponse = await schedRes.json()
      const statsData: StatsResponse = await statsRes.json()
      const advData: AdvancementsResponse = advRes.ok ? await advRes.json() : { items: [], count: 0 }
      setSchedules(schedData)
      setStats(statsData)
      setAdvancements(advData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  async function markAdvancementTriggered(scanId: string) {
    try {
      await fetch(`/api/admin/arc-advancement-scans/${scanId}`, { method: 'PATCH' })
    } catch {
      // non-fatal — banner will disappear after next page refresh
    }
  }

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  async function runBackfill() {
    if (!confirm('Backfill ArcPhaseSchedule records for existing arcs that pre-date Step 3? Idempotent — skips any arc that already has schedules.')) return
    setBackfillStatus('Running...')
    try {
      const res = await fetch('/api/admin/arc-schedules/backfill', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Backfill failed')
      setBackfillStatus(
        `Backfilled ${data.backfilled} of ${data.totalNewArcs} new_arc stories. ` +
        `${data.alreadyHadSchedules} already had schedules. ${data.tailReached} at tail.`,
      )
      await fetchAll()
    } catch (e) {
      setBackfillStatus(`Error: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.12em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Admin · Signals
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Arc Queue
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-secondary)' }}>
            Primary daily operational tool — story arc re-analyses by due date.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <button
            onClick={runBackfill}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '8px 16px',
              background: 'var(--accent-amber)',
              color: '#0A0A0B',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: 600,
            }}
            title="One-off fix for arcs that existed before Step 3 was deployed"
          >
            Backfill existing arcs
          </button>
          {backfillStatus && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 320, textAlign: 'right', padding: '4px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 3 }}>
              {backfillStatus}
            </span>
          )}
        </div>
      </div>

      {/* Ratio stats bar */}
      {stats && <RatioBar stats={stats} />}

      {/* Advancement detected banners (Step 4 — medium+ confidence only) */}
      {advancements && advancements.count > 0 && (
        <div style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {advancements.items.map(item => (
            <AdvancementBanner
              key={item.scanId}
              item={item}
              onTrigger={() => markAdvancementTriggered(item.scanId)}
            />
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--accent-red)', color: '#fff', borderRadius: 4, marginBottom: 24 }}>
          Error: {error}
        </div>
      )}

      {loading && <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</p>}

      {schedules && !loading && (
        <>
          {schedules.counts.overdue === 0 && schedules.counts.dueToday === 0 && schedules.counts.upcoming === 0 && (
            <div style={{
              border: '1px dashed var(--border-primary)',
              borderRadius: 4,
              padding: '32px 24px',
              textAlign: 'center',
              marginBottom: 32,
            }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                No arc schedules found yet.
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 520, margin: '0 auto' }}>
                Either no core story arcs have been created yet, or your existing arcs pre-date the Step 3 deploy. <br />
                Click <strong style={{ color: 'var(--text-secondary)' }}>Backfill existing arcs</strong> above to create schedules for pre-existing arcs.
              </p>
            </div>
          )}

          <QueueSection
            title="OVERDUE"
            count={schedules.counts.overdue}
            items={schedules.overdue}
            emptyMessage="No overdue arc re-analyses."
            accent="var(--accent-red)"
            onSkip={setSkipModal}
          />
          <QueueSection
            title="DUE TODAY"
            count={schedules.counts.dueToday}
            items={schedules.dueToday}
            emptyMessage="Nothing due today."
            accent="var(--accent-amber)"
            onSkip={setSkipModal}
          />
          <QueueSection
            title="UPCOMING (7 DAYS)"
            count={schedules.counts.upcoming}
            items={schedules.upcoming}
            emptyMessage="Nothing upcoming in the next 7 days."
            accent="var(--text-tertiary)"
            onSkip={setSkipModal}
          />
        </>
      )}

      {/* Skip & reschedule modal */}
      {skipModal && (
        <SkipModal
          schedule={skipModal}
          onClose={() => setSkipModal(null)}
          onSuccess={() => {
            setSkipModal(null)
            fetchAll()
          }}
        />
      )}
    </div>
  )
}

function RatioBar({ stats }: { stats: StatsResponse }) {
  const statusColor =
    stats.target.status === 'above' ? 'var(--accent-green)' :
    stats.target.status === 'on' ? 'var(--accent-amber)' :
    'var(--accent-red)'
  const statusLabel =
    stats.target.status === 'above' ? 'Above target' :
    stats.target.status === 'on' ? 'On target' : 'Below target'

  return (
    <div style={{
      border: '1px solid var(--border-primary)',
      borderRadius: 4,
      padding: '16px 20px',
      marginBottom: '32px',
      background: 'var(--bg-secondary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          {stats.month.label} · {stats.total} analyses
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: statusColor }}>
          {statusLabel} ({stats.target.actual}% arc+tagged / {stats.target.arcAndTaggedPct}% target)
        </span>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <RatioCell label="Story arcs" count={stats.storyArc.count} pct={stats.storyArc.pct} color="var(--accent-green)" />
        <RatioCell label="Umbrella-tagged" count={stats.umbrellaTagged.count} pct={stats.umbrellaTagged.pct} color="var(--accent-blue)" />
        <RatioCell label="Standalone" count={stats.standalone.count} pct={stats.standalone.pct} color="var(--text-tertiary)" />
      </div>
    </div>
  )
}

function RatioCell({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color }}>
          {count}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

function QueueSection({
  title,
  count,
  items,
  emptyMessage,
  accent,
  onSkip,
}: {
  title: string
  count: number
  items: ScheduleItem[]
  emptyMessage: string
  accent: string
  onSkip: (item: ScheduleItem) => void
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-primary)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', color: accent, fontWeight: 600 }}>
          {title} ({count})
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-primary)' }} />
      </div>

      {items.length === 0 ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: '24px 0' }}>
          {emptyMessage}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => <ScheduleRow key={item.id} item={item} accent={accent} onSkip={onSkip} />)}
        </div>
      )}
    </div>
  )
}

function ScheduleRow({ item, accent, onSkip }: { item: ScheduleItem; accent: string; onSkip: (item: ScheduleItem) => void }) {
  const isOverdue = item.daysOverdue > 0
  const nextPhase = PHASE_ORDER[item.targetPhase] ?? item.targetPhase
  const arcLabel = item.arc?.arcLabel ?? item.arc?.headline ?? '(untitled arc)'

  // Pre-fill query params for analyze form
  const rerunUrl = new URLSearchParams()
  if (item.umbrella) rerunUrl.set('umbrella', item.umbrella.id)
  rerunUrl.set('type', 'arc_rerun')
  if (item.arc) rerunUrl.set('arc', item.arc.storyId)
  rerunUrl.set('phase', item.targetPhase)
  // Pass the query directly so the form fills it synchronously on mount
  // (avoids waiting for the arcs API → selectedArc resolution chain).
  if (item.arc?.searchQuery) rerunUrl.set('query', item.arc.searchQuery)

  return (
    <div style={{
      border: '1px solid var(--border-primary)',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 4,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {arcLabel}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', background: 'var(--border-primary)', borderRadius: 2, color: 'var(--text-secondary)' }}>
            {PHASE_LABELS[item.targetPhase] ?? item.targetPhase} → {nextPhase}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
          {item.umbrella ? (
            <a href={`/admin/signals/umbrellas/${item.umbrella.id}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
              {item.umbrella.name}
            </a>
          ) : '(no umbrella)'}
          {' · '}
          {item.umbrella && formatCategory(item.umbrella.signalCategory)}
          {' · '}
          {isOverdue ? (
            <span style={{ color: 'var(--accent-red)' }}>{item.daysOverdue}d overdue</span>
          ) : (
            <span>due in {item.daysUntilDue}d</span>
          )}
          {' · '}
          {formatRelativeDate(item.scheduledFor)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <a
          href={`/admin?${rerunUrl.toString()}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '6px 12px',
            background: 'var(--accent-green)',
            color: '#000',
            borderRadius: 3,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Run re-analysis
        </a>
        <button
          onClick={() => onSkip(item)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '6px 12px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          Skip & reschedule
        </button>
      </div>
    </div>
  )
}

function SkipModal({
  schedule,
  onClose,
  onSuccess,
}: {
  schedule: ScheduleItem
  onClose: () => void
  onSuccess: () => void
}) {
  const defaultDate = new Date()
  defaultDate.setDate(defaultDate.getDate() + 7)
  const [newDate, setNewDate] = useState(defaultDate.toISOString().substring(0, 16))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/arc-schedules/${schedule.id}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newScheduledFor: new Date(newDate).toISOString(),
          reason: reason.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      onSuccess()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 6,
          padding: 24,
          width: '100%',
          maxWidth: 460,
        }}
      >
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
          Skip & reschedule
        </h3>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 20 }}>
          {schedule.arc?.arcLabel ?? '(untitled)'} · {PHASE_LABELS[schedule.targetPhase]}
        </p>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            New target date
          </span>
          <input
            type="datetime-local"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '8px 10px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 3,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Reason (optional)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Story is on hiatus pending court ruling"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: '8px 10px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 3,
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              resize: 'vertical',
            }}
          />
        </label>

        {err && (
          <p style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
            {err}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-primary)',
              borderRadius: 3,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '8px 16px',
              background: 'var(--accent-amber)',
              color: '#000',
              border: 'none',
              borderRadius: 3,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {submitting ? 'Saving…' : 'Confirm skip'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AdvancementBanner({ item, onTrigger }: { item: AdvancementItem; onTrigger: () => void }) {
  // Pre-fill URL for full re-analysis — same pattern as arc-queue rerun button
  const params = new URLSearchParams()
  params.set('umbrella', item.umbrellaArcId)
  params.set('type', 'arc_rerun')
  params.set('arc', item.storyArcId)
  if (item.arcPhaseAtCreation) params.set('phase', item.arcPhaseAtCreation)
  if (item.searchQuery) params.set('query', item.searchQuery)

  const confidenceColor = item.confidenceLevel === 'high' ? 'var(--accent-red)' : 'var(--accent-amber)'

  return (
    <div style={{
      border: '1px solid ' + confidenceColor,
      borderLeft: `4px solid ${confidenceColor}`,
      padding: '14px 16px',
      background: 'var(--bg-secondary)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', background: confidenceColor, color: '#0A0A0B', borderRadius: 2, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Advancement Detected · {item.confidenceLevel}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {item.arcLabel}
          </span>
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 4 }}>
          {item.rationale ?? '(no rationale)'}
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
          {item.umbrellaName} · scanned {new Date(item.scannedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
      <a
        href={`/admin?${params.toString()}`}
        onClick={onTrigger}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          padding: '8px 14px',
          background: confidenceColor,
          color: '#0A0A0B',
          borderRadius: 3,
          textDecoration: 'none',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Run full analysis now
      </a>
    </div>
  )
}
