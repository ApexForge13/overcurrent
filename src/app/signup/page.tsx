"use client"
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="max-w-[400px] mx-auto px-6 py-20 text-center">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
          Check your email
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-secondary)' }}>
          We sent a confirmation link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>. Click it to activate your account.
        </p>
        <a href="/login" className="inline-block mt-6" style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--accent-blue)', textDecoration: 'underline' }}>
          Back to sign in
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-[400px] mx-auto px-6 py-20">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
        Create account
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-tertiary)', marginBottom: '32px' }}>
        10 free analyses. Full experience. No feature restrictions.
      </p>

      <form onSubmit={handleSignup} className="space-y-4">
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
            minLength={6}
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
          {loading ? 'creating account...' : 'create account'}
        </button>
      </form>

      <p className="mt-6 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
        Already have an account? <a href="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Sign in</a>
      </p>
    </div>
  )
}
