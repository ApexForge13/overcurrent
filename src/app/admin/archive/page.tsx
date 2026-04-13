"use client"
import { useState, useEffect, useCallback } from 'react'

interface ArchivedStory {
  id: string
  slug: string
  headline: string
  synopsis: string
  primaryCategory: string | null
  sourceCount: number
  countryCount: number
  regionCount: number
  confidenceLevel: string
  consensusScore: number
  totalCost: number | null
  status: string
  createdAt: string
}

export default function ArchivePage() {
  const [stories, setStories] = useState<ArchivedStory[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)

  const fetchArchived = useCallback(() => {
    setLoading(true)
    fetch(`/api/admin/stories?status=archived&page=${page}&limit=20`)
      .then(r => r.json())
      .then(data => {
        setStories(data.stories ?? [])
        setTotalPages(data.pagination?.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => { fetchArchived() }, [fetchArchived])

  async function restoreStory(id: string) {
    setActionInFlight(id)
    try {
      await fetch(`/api/admin/stories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'review' }),
      })
      setStories(prev => prev.filter(s => s.id !== id))
    } catch {
      // ignore
    } finally {
      setActionInFlight(null)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '20px', color: 'var(--text-primary)' }}>
          Archived Stories
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Stories removed from public view. Restore to move back to review.
        </p>
      </div>

      {loading ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)', padding: '40px 0', textAlign: 'center' }}>
          Loading archived stories...
        </div>
      ) : stories.length === 0 ? (
        <div style={{
          padding: '60px 20px',
          textAlign: 'center',
          border: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
            No archived stories.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {stories.map(story => (
            <div key={story.id} style={{
              padding: '16px 20px',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
            }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={`/story/${story.slug}`}
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      {story.headline}
                    </a>
                    {story.primaryCategory && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        padding: '1px 6px',
                        color: 'var(--accent-purple)',
                        border: '1px solid var(--accent-purple)',
                        opacity: 0.6,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        {story.primaryCategory}
                      </span>
                    )}
                  </div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
                    {story.synopsis?.substring(0, 200)}
                    {(story.synopsis?.length ?? 0) > 200 ? '...' : ''}
                  </p>
                  <div className="flex gap-4 mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    <span>{story.sourceCount} sources</span>
                    <span>{story.countryCount} countries</span>
                    <span>{story.regionCount} regions</span>
                    <span>{story.confidenceLevel}</span>
                    {story.totalCost != null && <span>${story.totalCost.toFixed(2)}</span>}
                    <span>{new Date(story.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => restoreStory(story.id)}
                    disabled={actionInFlight === story.id}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      padding: '4px 12px',
                      color: 'var(--accent-amber)',
                      border: '1px solid var(--accent-amber)',
                      background: 'transparent',
                      cursor: actionInFlight === story.id ? 'wait' : 'pointer',
                      opacity: actionInFlight === story.id ? 0.5 : 1,
                    }}
                  >
                    Restore
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              padding: '4px 10px',
              color: page <= 1 ? 'var(--text-tertiary)' : 'var(--text-secondary)',
              border: '1px solid var(--border-primary)',
              background: 'transparent',
              cursor: page <= 1 ? 'default' : 'pointer',
            }}
          >
            prev
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              padding: '4px 10px',
              color: page >= totalPages ? 'var(--text-tertiary)' : 'var(--text-secondary)',
              border: '1px solid var(--border-primary)',
              background: 'transparent',
              cursor: page >= totalPages ? 'default' : 'pointer',
            }}
          >
            next
          </button>
        </div>
      )}
    </div>
  )
}
