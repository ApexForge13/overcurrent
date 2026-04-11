"use client"
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export function AuthNav() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {user.email}
        </span>
        <button
          onClick={handleLogout}
          style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
          className="hover:opacity-80"
        >
          logout
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <a href="/login" style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-tertiary)' }} className="hover:opacity-80">
        sign in
      </a>
      <a href="/signup" style={{
        fontFamily: 'var(--font-mono)', fontSize: '12px',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-primary)',
        padding: '4px 12px',
      }} className="hover:opacity-80">
        sign up
      </a>
    </div>
  )
}
