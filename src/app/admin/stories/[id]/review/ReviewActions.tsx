'use client'
import { useState } from 'react'

export function ReviewActions({ storyId, versionId }: { storyId: string; versionId: string }) {
  const [status, setStatus] = useState<string | null>(null)

  async function handleAction(action: 'approve' | 'reject') {
    const confirmed = confirm(
      action === 'approve'
        ? 'Approve and publish this version? The updated analysis will go live.'
        : 'Reject this version? All V2 changes will be discarded.'
    )
    if (!confirmed) return

    setStatus(`${action === 'approve' ? 'Publishing' : 'Rejecting'}...`)
    try {
      const resp = await fetch(`/api/admin/stories/${storyId}/reanalyze`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, versionId }),
      })
      const data = await resp.json()
      if (data.success) {
        setStatus(action === 'approve' ? 'Published! Redirecting...' : 'Rejected. Redirecting...')
        setTimeout(() => window.location.href = '/admin', 1500)
      } else {
        setStatus(`Error: ${data.error}`)
      }
    } catch {
      setStatus('Failed')
    }
  }

  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
      <button
        onClick={() => handleAction('approve')}
        disabled={!!status}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600,
          padding: '10px 24px', background: '#2A9D8F', color: '#0A0A0B',
          border: 'none', borderRadius: '4px', cursor: 'pointer',
        }}
      >
        {status || 'Approve & Publish'}
      </button>
      <button
        onClick={() => handleAction('reject')}
        disabled={!!status}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600,
          padding: '10px 24px', background: 'transparent', color: '#E24B4A',
          border: '1px solid #E24B4A', borderRadius: '4px', cursor: 'pointer',
        }}
      >
        Reject
      </button>
      <a
        href="/admin"
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '13px',
          padding: '10px 24px', color: '#5C5A56',
          textDecoration: 'none', display: 'flex', alignItems: 'center',
        }}
      >
        Review later
      </a>
    </div>
  )
}
