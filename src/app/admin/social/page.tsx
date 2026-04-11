"use client"
import { useState, useEffect, useCallback } from 'react'
import { SocialPreview } from '@/components/admin/SocialPreview'

interface SocialDraft {
  id: string
  platform: string
  content: string
  editedContent: string | null
  metadata: string | null
  status: string
  scheduledFor: string | null
  createdAt: string
  story: { id: string; slug: string; headline: string; confidenceLevel: string } | null
}

const PLATFORM_ICONS: Record<string, string> = {
  twitter_hook: '\u{1D54F}',
  twitter_thread: '\uD83E\uDDF5',
  reddit: '\uD83E\uDD16',
  linkedin: '\uD83D\uDCBC',
  tiktok: '\uD83C\uDFAC',
  newsletter: '\uD83D\uDCE7',
}

const PLATFORM_LIMITS: Record<string, number | null> = {
  twitter_hook: 280,
  twitter_thread: 280,
  reddit: null,
  linkedin: 3000,
  tiktok: null,
  newsletter: null,
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  scheduled: 'bg-blue-500/20 text-blue-400',
  posted: 'bg-purple-500/20 text-purple-400',
  rejected: 'bg-red-500/20 text-red-400',
}

export default function SocialAdminPage() {
  const [drafts, setDrafts] = useState<SocialDraft[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)

  const fetchDrafts = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    if (platformFilter !== 'all') params.set('platform', platformFilter)
    const res = await fetch(`/api/admin/social-drafts?${params}`)
    if (res.ok) {
      const data = await res.json()
      setDrafts(data.drafts || [])
    }
  }, [filter, platformFilter])

  useEffect(() => { fetchDrafts() }, [fetchDrafts])

  async function updateDraft(id: string, data: Record<string, unknown>) {
    await fetch(`/api/admin/social-drafts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    fetchDrafts()
  }

  function startEdit(draft: SocialDraft) {
    setEditingId(draft.id)
    setEditText(draft.editedContent || draft.content)
  }

  function saveEdit(id: string) {
    updateDraft(id, { editedContent: editText })
    setEditingId(null)
  }

  function copyToClipboard(draft: SocialDraft) {
    const text = (draft.editedContent || draft.content).replace(/\[LINK\]/g, `https://overcurrent.vercel.app/story/${draft.story?.slug || ''}`)
    navigator.clipboard.writeText(text)
  }

  const displayContent = (d: SocialDraft) => d.editedContent || d.content
  const charCount = (text: string) => text.length

  // Group drafts by story
  const grouped = drafts.reduce((acc, d) => {
    const key = d.story?.headline || 'No Story'
    if (!acc[key]) acc[key] = { story: d.story, drafts: [] }
    acc[key].drafts.push(d)
    return acc
  }, {} as Record<string, { story: SocialDraft['story']; drafts: SocialDraft[] }>)

  return (
    <div>
      <h2 className="font-display font-bold text-xl mb-4">Social Content</h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['all', 'draft', 'approved', 'scheduled', 'posted', 'rejected'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 text-xs font-mono rounded-full border transition-colors ${filter === s ? 'border-accent-purple text-accent-purple' : 'border-border text-text-muted hover:text-text-secondary'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="text-border mx-2">|</span>
        {['all', 'twitter_hook', 'twitter_thread', 'reddit', 'linkedin', 'tiktok', 'newsletter'].map((p) => (
          <button key={p} onClick={() => setPlatformFilter(p)}
            className={`px-3 py-1 text-xs font-mono rounded-full border transition-colors ${platformFilter === p ? 'border-accent-green text-accent-green' : 'border-border text-text-muted hover:text-text-secondary'}`}>
            {p === 'all' ? 'All' : `${PLATFORM_ICONS[p] || ''} ${p}`}
          </button>
        ))}
      </div>

      {/* Draft groups */}
      {Object.entries(grouped).length === 0 && (
        <p className="text-text-muted text-center py-12">No social drafts yet. Run an analysis to generate content.</p>
      )}

      {Object.entries(grouped).map(([headline, group]) => (
        <div key={headline} className="mb-8 border border-border rounded-lg overflow-hidden">
          <div className="bg-surface px-4 py-3 border-b border-border">
            <h3 className="font-display font-semibold text-text-primary">{headline}</h3>
            <p className="text-xs text-text-muted font-mono">{group.drafts.length} drafts</p>
          </div>

          <div className="divide-y divide-border">
            {group.drafts.map((draft) => {
              const limit = PLATFORM_LIMITS[draft.platform]
              const content = displayContent(draft)
              const count = charCount(content)
              const overLimit = limit ? count > limit : false

              return (
                <div key={draft.id} className="p-4 hover:bg-surface-hover">
                  <div className="flex items-start gap-3">
                    <span className="text-xl" title={draft.platform}>{PLATFORM_ICONS[draft.platform] || '\uD83D\uDCDD'}</span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono text-text-muted">{draft.platform}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${STATUS_COLORS[draft.status] || ''}`}>
                          {draft.status}
                        </span>
                        {draft.editedContent && <span className="text-[10px] text-accent-amber font-mono">edited</span>}
                      </div>

                      {editingId === draft.id ? (
                        <div>
                          <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                            className="w-full bg-background border border-border rounded p-3 text-sm text-text-primary font-body resize-y min-h-[100px]"
                            rows={5} />
                          <div className="flex items-center justify-between mt-2">
                            <span className={`text-xs font-mono ${overLimit ? 'text-accent-red' : 'text-text-muted'}`}>
                              {charCount(editText)}{limit ? `/${limit}` : ''} chars
                            </span>
                            <div className="flex gap-2">
                              <button onClick={() => setEditingId(null)} className="text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                              <button onClick={() => saveEdit(draft.id)} className="text-xs bg-accent-green/20 text-accent-green px-3 py-1 rounded">Save</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">{content.substring(0, 500)}{content.length > 500 ? '...' : ''}</p>
                      )}

                      {editingId !== draft.id && (
                        <div className="flex items-center gap-3 mt-3">
                          <span className={`text-xs font-mono ${overLimit ? 'text-accent-red' : 'text-text-muted'}`}>
                            {count}{limit ? `/${limit}` : ''} chars
                          </span>
                          <button onClick={() => startEdit(draft)} className="text-xs text-text-muted hover:text-accent-green">Edit</button>
                          <button onClick={() => updateDraft(draft.id, { status: 'approved' })} className="text-xs text-text-muted hover:text-accent-green">Approve</button>
                          <button onClick={() => updateDraft(draft.id, { status: 'rejected' })} className="text-xs text-text-muted hover:text-accent-red">Reject</button>
                          <button onClick={() => copyToClipboard(draft)} className="text-xs text-text-muted hover:text-accent-purple">Copy</button>
                          <button onClick={() => setPreviewId(previewId === draft.id ? null : draft.id)} className="text-xs text-text-muted hover:text-accent-blue">
                            {previewId === draft.id ? 'Hide preview' : 'Preview'}
                          </button>
                        </div>
                      )}

                      {previewId === draft.id && (
                        <div className="mt-3">
                          <SocialPreview
                            platform={draft.platform}
                            content={displayContent(draft)}
                            headline={draft.story?.headline}
                            confidenceLevel={draft.story?.confidenceLevel}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
