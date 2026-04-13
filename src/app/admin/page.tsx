"use client"
import { useState, useEffect, useCallback } from 'react'
import { CoverageTracker } from '@/components/admin/CoverageTracker'

interface DashboardStats {
  totalStories: number
  totalReports: number
  totalDrafts: number
  draftsByStatus: Record<string, number>
  dailyCost: number
  totalCost: number
  activeSubscribers: number
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
  const [mapStatus, setMapStatus] = useState<Record<string, string>>({})
  const [analyzeMode, setAnalyzeMode] = useState<'verify' | 'undercurrent'>('verify')
  const [analyzeQuery, setAnalyzeQuery] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStatus, setAnalyzeStatus] = useState('')

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
      fetch('/api/admin/subscribers').then(r => r.json()),
    ]).then(([stories, reports, drafts, costs, subscribers]) => {
      setStats({
        totalStories: stories.pagination?.total ?? 0,
        totalReports: reports.pagination?.total ?? 0,
        totalDrafts: drafts.pagination?.total ?? 0,
        draftsByStatus: {},
        dailyCost: costs.dailyCost ?? 0,
        totalCost: costs.totalCost ?? 0,
        activeSubscribers: subscribers.active ?? 0,
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

  async function regenerateMap(storyId: string) {
    setMapStatus(prev => ({ ...prev, [storyId]: 'regenerating...' }))
    try {
      const resp = await fetch(`/api/admin/stories/${storyId}/regenerate-map`, { method: 'POST' })
      const data = await resp.json()
      if (data.success) {
        setMapStatus(prev => ({ ...prev, [storyId]: `done — ${data.regions} regions, ${data.frames} frames` }))
      } else {
        setMapStatus(prev => ({ ...prev, [storyId]: `error: ${data.error}` }))
      }
    } catch {
      setMapStatus(prev => ({ ...prev, [storyId]: 'failed' }))
    }
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    if (!analyzeQuery.trim() || isAnalyzing) return
    setIsAnalyzing(true)
    setAnalyzeStatus('Starting analysis...')

    // Use Railway pipeline service (no timeout) instead of Vercel serverless function
    const railwayBase = 'https://overcurrent-production.up.railway.app'
    const endpoint = analyzeMode === 'verify' ? `${railwayBase}/analyze` : `${railwayBase}/undercurrent`
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: analyzeQuery.trim() }),
      })
      if (!response.body) throw new Error('No stream')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              setAnalyzeStatus(data.message || data.phase || '')
              if (data.phase === 'complete') {
                setIsAnalyzing(false)
                setAnalyzeQuery('')
                setAnalyzeStatus('Complete — story is in review below')
                fetchReviewStories()
              }
              if (data.phase === 'error') {
                setIsAnalyzing(false)
                setAnalyzeStatus(`Error: ${data.message}`)
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setIsAnalyzing(false)
      setAnalyzeStatus('Analysis failed')
    }
  }

  return (
    <div>
      {/* Analyze form */}
      <div className="mb-8 p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
        <div className="flex items-center gap-3 mb-3">
          <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            New Analysis
          </h3>
          <button onClick={() => setAnalyzeMode('verify')}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '2px 8px', color: analyzeMode === 'verify' ? 'var(--accent-green)' : 'var(--text-tertiary)', border: analyzeMode === 'verify' ? '1px solid var(--accent-green)' : '1px solid transparent', background: 'none', cursor: 'pointer' }}>
            verify
          </button>
          <button onClick={() => setAnalyzeMode('undercurrent')}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '2px 8px', color: analyzeMode === 'undercurrent' ? 'var(--accent-purple)' : 'var(--text-tertiary)', border: analyzeMode === 'undercurrent' ? '1px solid var(--accent-purple)' : '1px solid transparent', background: 'none', cursor: 'pointer' }}>
            undercurrent
          </button>
        </div>
        <form onSubmit={handleAnalyze} className="flex gap-3">
          <input type="text" value={analyzeQuery} onChange={e => setAnalyzeQuery(e.target.value)}
            placeholder={analyzeMode === 'verify' ? 'Enter a story to analyze...' : 'Enter the dominant story...'}
            disabled={isAnalyzing}
            style={{ flex: 1, padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', outline: 'none' }} />
          <button type="submit" disabled={isAnalyzing || !analyzeQuery.trim()}
            style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', background: 'transparent', cursor: isAnalyzing ? 'wait' : 'pointer', opacity: isAnalyzing ? 0.5 : 1 }}>
            {isAnalyzing ? 'analyzing...' : 'analyze'}
          </button>
        </form>
        {analyzeStatus && (
          <p className="mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: isAnalyzing ? 'var(--accent-amber)' : analyzeStatus.includes('Error') ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            {analyzeStatus}
          </p>
        )}
      </div>

      <h2 className="font-display font-bold text-xl mb-6">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="Stories" value={stats?.totalStories ?? 0} />
        <StatCard label="Reports" value={stats?.totalReports ?? 0} />
        <StatCard label="Social Drafts" value={stats?.totalDrafts ?? 0} />
        <StatCard label="Today's Cost" value={`$${(stats?.dailyCost ?? 0).toFixed(2)}`} />
        <StatCard label="Subscribers" value={stats?.activeSubscribers ?? 0} />
      </div>

      <div className="mt-8 p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
        <CoverageTracker />
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
                  <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                    <button
                      onClick={() => regenerateMap(story.id)}
                      disabled={!!mapStatus[story.id]?.startsWith('regenerating')}
                      className="px-3 py-1.5 text-sm font-mono rounded bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30 transition-colors disabled:opacity-50"
                    >
                      {mapStatus[story.id]?.startsWith('regenerating') ? 'rebuilding...' : 'Regen Map'}
                    </button>
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
                  {mapStatus[story.id] && !mapStatus[story.id].startsWith('regenerating') && (
                    <p className="text-xs font-mono mt-1 text-right" style={{ color: mapStatus[story.id].startsWith('done') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {mapStatus[story.id]}
                    </p>
                  )}
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
