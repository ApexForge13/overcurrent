'use client'

import { useState, useTransition } from 'react'

export function TriggerToggle({
  triggerId,
  initialEnabled,
}: {
  triggerId: string
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onToggle = () => {
    const next = !enabled
    setEnabled(next) // optimistic
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/triggers/${triggerId}/toggle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
        if (!res.ok) {
          setEnabled(!next) // rollback
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `HTTP ${res.status}`)
        }
      } catch (err) {
        setEnabled(!next)
        setError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={isPending}
        className={`inline-flex items-center gap-2 px-3 py-1 rounded font-mono text-xs border transition-colors ${
          enabled
            ? 'border-accent-green text-accent-green hover:bg-accent-green/10'
            : 'border-text-muted text-text-muted hover:bg-text-muted/10'
        } ${isPending ? 'opacity-50' : ''}`}
      >
        <span className={`inline-block w-2 h-2 rounded-full ${enabled ? 'bg-accent-green' : 'bg-text-muted'}`} />
        {enabled ? 'ENABLED' : 'DISABLED'}
      </button>
      {error && <span className="text-xs text-accent-red">{error}</span>}
    </div>
  )
}
