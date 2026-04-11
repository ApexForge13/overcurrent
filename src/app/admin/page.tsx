"use client"
import { useState, useEffect } from 'react'

interface DashboardStats {
  totalStories: number
  totalReports: number
  totalDrafts: number
  draftsByStatus: Record<string, number>
  dailyCost: number
  totalCost: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/stories?limit=1').then(r => r.json()),
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
  }, [])

  return (
    <div>
      <h2 className="font-display font-bold text-xl mb-6">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Stories" value={stats?.totalStories ?? 0} />
        <StatCard label="Reports" value={stats?.totalReports ?? 0} />
        <StatCard label="Social Drafts" value={stats?.totalDrafts ?? 0} />
        <StatCard label="Today's Cost" value={`$${(stats?.dailyCost ?? 0).toFixed(2)}`} />
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
