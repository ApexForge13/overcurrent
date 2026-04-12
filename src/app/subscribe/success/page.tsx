"use client"
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SubscribeSuccessPage() {
  const supabase = createClient()

  useEffect(() => {
    // Refresh the session to pick up updated user_metadata
    supabase.auth.refreshSession()
  }, [supabase.auth])

  return (
    <div className="max-w-[480px] mx-auto px-6 py-20 text-center">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
        Welcome to Overcurrent
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '24px' }}>
        Your subscription is active. You now have unlimited access to every analysis, framing split, discourse gap, and propagation map.
      </p>
      <a href="/" style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-primary)',
        padding: '10px 24px',
        textDecoration: 'none',
        display: 'inline-block',
      }}>
        start reading
      </a>
    </div>
  )
}
