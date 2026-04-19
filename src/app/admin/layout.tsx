import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'connermhecht13@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !user.email || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    redirect('/login')
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">ADMIN</h1>
          <p className="text-xs text-text-muted font-mono">Overcurrent Editorial Dashboard</p>
        </div>
        <nav className="flex gap-4 text-sm font-mono flex-wrap">
          <a href="/admin" className="text-text-secondary hover:text-accent-green">Dashboard</a>
          <a href="/admin/signals/umbrellas" className="text-text-secondary hover:text-accent-teal">Umbrellas</a>
          <a href="/admin/signals/arc-queue" className="text-text-secondary hover:text-accent-teal">Arc Queue</a>
          <a href="/admin/signals/predictive" className="text-text-secondary hover:text-accent-teal">Predictive</a>
          <a href="/admin/social" className="text-text-secondary hover:text-accent-purple">Social</a>
          <a href="/admin/archive" className="text-text-secondary hover:text-accent-amber">Archive</a>
          <a href="/admin/costs" className="text-text-secondary hover:text-accent-amber">Costs</a>
          <a href="/admin/tiktok" className="text-text-secondary hover:text-accent-purple">TikTok</a>
          <a href="/api/admin/newsletter" className="text-text-secondary hover:text-accent-amber">Newsletter</a>
          <a href="/" className="text-text-muted hover:text-text-secondary">&larr; Site</a>
        </nav>
      </div>
      {children}
    </div>
  )
}
