"use client"
import { useState, useEffect } from 'react'

interface Story {
  id: string
  slug: string
  headline: string
}

interface TikTokEntry {
  url: string
  caption: string
  views: number
  likes: number
  framingType: string
}

export default function TikTokAdminPage() {
  const [stories, setStories] = useState<Story[]>([])
  const [selectedStory, setSelectedStory] = useState('')
  const [entries, setEntries] = useState<TikTokEntry[]>([{ url: '', caption: '', views: 0, likes: 0, framingType: 'other' }])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetch('/api/admin/stories?limit=50')
      .then(r => r.json())
      .then(d => setStories(d.stories || []))
      .catch(() => {})
  }, [])

  function addEntry() {
    setEntries([...entries, { url: '', caption: '', views: 0, likes: 0, framingType: 'other' }])
  }

  function updateEntry(idx: number, field: string, value: string | number) {
    const updated = [...entries]
    updated[idx] = { ...updated[idx], [field]: value }
    setEntries(updated)
  }

  function removeEntry(idx: number) {
    setEntries(entries.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedStory || entries.length === 0) return
    setSubmitting(true)

    try {
      await fetch('/api/admin/discourse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: selectedStory,
          platform: 'tiktok',
          posts: entries.filter(e => e.caption.trim()),
        }),
      })
      setSuccess(true)
    } catch { /* silent */ }
    setSubmitting(false)
  }

  const FRAMING_TYPES = ['crime', 'labor', 'financial', 'solidarity', 'outrage', 'humor', 'skepticism', 'conspiracy', 'counter_narrative', 'other']

  if (success) {
    return (
      <div className="text-center py-12">
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--accent-green)' }}>TikTok data saved.</p>
        <button onClick={() => { setSuccess(false); setEntries([{ url: '', caption: '', views: 0, likes: 0, framingType: 'other' }]) }}
          className="mt-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
          Add more
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>
        Add TikTok Discourse
      </h2>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '24px' }}>
        Watch the top TikToks about a story and log the framing. This data feeds into the discourse gap analysis.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>STORY</label>
          <select value={selectedStory} onChange={e => setSelectedStory(e.target.value)}
            style={{ width: '100%', padding: '8px', fontFamily: 'var(--font-body)', fontSize: '13px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}>
            <option value="">Select a story...</option>
            {stories.map(s => <option key={s.id} value={s.id}>{s.headline}</option>)}
          </select>
        </div>

        {entries.map((entry, i) => (
          <div key={i} style={{ border: '1px solid var(--border-primary)', padding: '12px', position: 'relative' }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>TikTok {i + 1}</span>
              {entries.length > 1 && (
                <button type="button" onClick={() => removeEntry(i)} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-red)', background: 'none', border: 'none', cursor: 'pointer' }}>remove</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="TikTok URL" value={entry.url} onChange={e => updateEntry(i, 'url', e.target.value)}
                style={{ padding: '6px 8px', fontFamily: 'var(--font-body)', fontSize: '12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', gridColumn: '1 / -1' }} />
              <textarea placeholder="Caption / key message" value={entry.caption} onChange={e => updateEntry(i, 'caption', e.target.value)} rows={2}
                style={{ padding: '6px 8px', fontFamily: 'var(--font-body)', fontSize: '12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', gridColumn: '1 / -1', resize: 'vertical' }} />
              <input type="number" placeholder="Views" value={entry.views || ''} onChange={e => updateEntry(i, 'views', parseInt(e.target.value) || 0)}
                style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }} />
              <input type="number" placeholder="Likes" value={entry.likes || ''} onChange={e => updateEntry(i, 'likes', parseInt(e.target.value) || 0)}
                style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }} />
              <select value={entry.framingType} onChange={e => updateEntry(i, 'framingType', e.target.value)}
                style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', gridColumn: '1 / -1' }}>
                {FRAMING_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        ))}

        <button type="button" onClick={addEntry} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>
          + add another TikTok
        </button>

        <div>
          <button type="submit" disabled={submitting || !selectedStory}
            style={{ padding: '8px 20px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', background: 'transparent', cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.5 : 1 }}>
            {submitting ? 'saving...' : 'save tiktok data'}
          </button>
        </div>
      </form>
    </div>
  )
}
