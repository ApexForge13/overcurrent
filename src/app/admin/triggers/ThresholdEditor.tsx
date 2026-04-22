'use client'

import { useState, useTransition } from 'react'

export function ThresholdEditor({
  triggerId,
  initialOverrides,
}: {
  triggerId: string
  initialOverrides: Record<string, number> | null
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(
    initialOverrides ? JSON.stringify(initialOverrides, null, 2) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const isClear = text.trim() === '' || text.trim() === 'null'

  const onSave = () => {
    setError(null)
    setSaved(false)
    let parsed: object | null = null
    if (!isClear) {
      try {
        parsed = JSON.parse(text)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid JSON')
        return
      }
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/triggers/${triggerId}/thresholds`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ thresholdOverrides: parsed }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setSaved(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono text-text-secondary hover:text-accent-blue underline"
      >
        {open ? 'hide' : initialOverrides ? 'override (edit)' : 'override'}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 max-w-md">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSaved(false)
            }}
            placeholder='{ "z_floor": 2.5 }  — or empty to clear'
            rows={5}
            className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-text-primary"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isPending}
              className="px-3 py-1 rounded text-xs font-mono border border-accent-blue text-accent-blue hover:bg-accent-blue/10 disabled:opacity-50"
            >
              {isPending ? 'saving…' : isClear ? 'clear' : 'save'}
            </button>
            {saved && <span className="text-xs text-accent-green">saved</span>}
            {error && <span className="text-xs text-accent-red">{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
