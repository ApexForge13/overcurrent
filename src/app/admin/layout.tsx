export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">ADMIN</h1>
          <p className="text-xs text-text-muted font-mono">Overcurrent Editorial Dashboard</p>
        </div>
        <nav className="flex gap-4 text-sm font-mono">
          <a href="/admin" className="text-text-secondary hover:text-accent-green">Dashboard</a>
          <a href="/admin/social" className="text-text-secondary hover:text-accent-purple">Social</a>
          <a href="/costs" className="text-text-secondary hover:text-text-muted">Costs</a>
          <a href="/" className="text-text-muted hover:text-text-secondary">← Site</a>
        </nav>
      </div>
      {children}
    </div>
  )
}
