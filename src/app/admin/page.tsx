"use client"
import { useState, useEffect, useCallback } from 'react'

interface DashboardStats {
  totalStories: number
  totalReports: number
  totalDrafts: number
  draftsByStatus: Record<string, number>
  dailyCost: number
  totalCost: number
}

interface ReviewStory {
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
  status: string
  createdAt: string
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [reviewStories, setReviewStories] = useState<ReviewStory[]>([] )
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)

  const fetchReviewStories = useCallback(() => {
    fetch('/api/admin/stories?status=review')
      .then(r => r.json())
      .then(data => setReviewStories(data.stories ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/stories?limit=1').then(r => r.json()),
      fetch('/api/reports?limit=1').then(r => r.json()),
      fetch('/api/admin/social-drafts?limit=1').then(r => r.json()),
      fetch('/api/costs').then(r => r.json()),
    ]).then(([stories, reports, drafts, costs]) => {
      setStats({
        totalStories: stories.pagination?.total ?? 0,
        totalReports: reports.pagination?.total ?? 0,
        totalDrafts: drafts.pagination?.total ?? 0,
        draftsByStatus: {},
        dailyCost: costs.dailyCost ?? 0,
        totalCost: costs.totalCost ?? 0,
      })
    }).catch(() => {})

    fetchReviewStories()
  }, [fetchReviewStories])

  async function updateStoryStatus(id: string, status: 'published' | 'archived') {
    setActionInFlight(id)
    try {
      await fetch(`/api/admin/stories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setReviewStories(prev => prev.filter(s => s.id !== id))
    } catch {
      // ignore
    } finally {
      setActionInFlight(null)
    }
  }

  return (
    <div>
      <h2 className="font-display font-bold text-xl mb-6">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Stories" value={stats?.totalStories ?? 0} />
        <StatCard label="Reports" value={stats?.totalReports ?? 0} />
        <StatCard label="Social Drafts" value={stats?.totalDrafts ?? 0} />
        <StatCard label="Today's Cost" value={`$${(stats?.dailyCost ?? 0).toFixed(2)}`} />
      </div>

      <div className="mb-8">
        <h3 className="font-display font-bold text-lg mb-4">Stories in review</h3>
        {reviewStories.length === 0 ? (
          <p className="text-sm text-text-muted">No stories awaiting review.</p>
        ) : (
          <div className="space-y-3">
            {reviewStories.map(story => (
              <div key={story.id} className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <a href={`/story/${story.slug}`} className="font-display font-bold text-text-primary hover:text-accent-purple transition-colors">
                      {story.headline}
                    </a>
                    {story.primaryCategory && (
                      <span className="ml-2 inline-block text-xs font-mono px-2 py-0.5 rounded bg-accent-purple/10 text-accent-purple">
                        {story.primaryCategory}
                      </span>
                    )}
                    <p className="text-sm text-text-muted mt-1 line-clamp-2">{story.synopsis}</p>
                    <div className="flex gap-4 mt-2 text-xs font-mono text-text-muted">
                      <span>{story.sourceCount} sources</span>
                      <span>{story.countryCount} countries</span>
                      <span>{story.regionCount} regions</span>
                      <span>{story.confidenceLevel}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateStoryStatus(story.id, 'published')}
                      disabled={actionInFlight === story.id}
                      className="px-3 py-1.5 text-sm font-mono rounded bg-accent-green/20 text-accent-green hover:bg-accent-green/30 transition-colors disabled:opacity-50"
                    >
                      Publish
                    </button>
                    <button
                      onClick={() => updateStoryStatus(story.id, 'archived')}
                      disabled={actionInFlight === story.id}
                      className="px-3 py-1.5 text-sm font-mono rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <a href="/admin/social" className="bg-surface border border-border rounded-lg p-6 hover:border-accent-purple transition-colors">
          <h3 className="font-display font-bold text-lg mb-2 text-accent-purple">Social Content</h3>
          <p className="text-sm text-text-muted">Review and approve AI-generated social media drafts</p>
        </a>
        <a href="/costs" className="bg-surface border border-border rounded-lg p-6 hover:border-accent-green transition-colors">
          <h3 className="font-display font-bold text-lg mb-2 text-accent-green">Cost Dashboard</h3>
          <p className="text-sm text-text-muted">Monitor API costs across all providers</p>
        </a>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <p className="text-xs text-text-muted font-mono mb-1">{label}</p>
      <p className="text-2xl font-mono font-semibold text-text-primary">{String(value)}</p>
    </div>
  )
}
