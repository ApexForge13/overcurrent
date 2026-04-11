"use client"
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Check for redirect param
    const params = new URLSearchParams(window.location.search)
    const redirect = params.get('redirect') || '/'
    router.push(redirect)
    router.refresh()
  }

  return (
    <div className="max-w-[400px] mx-auto px-6 py-20">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
        Sign in
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '32px' }}>
        Sign in to access your account.
      </p>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>EMAIL</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%', padding: '10px 12px',
              fontFamily: 'var(--font-body)', fontSize: '14px',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)', outline: 'none',
            }}
          />
        </div>
        <div>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>PASSWORD</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: '100%', padding: '10px 12px',
              fontFamily: 'var(--font-body)', fontSize: '14px',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)', outline: 'none',
            }}
          />
        </div>

        {error && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-red)' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '10px',
            fontFamily: 'var(--font-mono)', fontSize: '13px',
            color: 'var(--text-primary)',
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'signing in...' : 'sign in'}
        </button>
      </form>

      <p className="mt-6 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
        Don&apos;t have an account? <a href="/signup" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Sign up</a>
      </p>
    </div>
  )
}
