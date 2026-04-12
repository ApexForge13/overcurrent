"use client"
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const PLANS = [
  { id: 'monthly', name: 'Monthly', price: '$4.99', interval: '/mo', description: 'Full access to all analyses' },
  { id: 'annual', name: 'Annual', price: '$39.99', interval: '/yr', description: 'Save 33%', badge: 'BEST VALUE' },
  { id: 'founding', name: 'Founding Member', price: '$3.99', interval: '/mo forever', description: 'Locked for life — first 500', badge: 'LIMITED' },
]

export default function SubscribePage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleCheckout(planId: string) {
    setLoading(planId)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = '/signup?redirect=/subscribe'
      return
    }

    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })

      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Failed to start checkout')
      }
    } catch {
      setError('Something went wrong')
    }
    setLoading(null)
  }

  return (
    <div className="max-w-[600px] mx-auto px-6 py-16">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
        Subscribe to Overcurrent
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.6 }}>
        Every outlet shows you their version. We show you everyone&apos;s.
      </p>

      <div className="space-y-4">
        {PLANS.map((plan) => (
          <div key={plan.id} style={{
            border: plan.badge ? '1px solid var(--accent-green)' : '1px solid var(--border-primary)',
            padding: '24px',
            position: 'relative',
            background: plan.badge === 'LIMITED' ? 'rgba(42,157,143,0.03)' : 'transparent',
          }}>
            {plan.badge && (
              <span style={{
                position: 'absolute',
                top: '-10px',
                right: '16px',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'var(--accent-green)',
                background: 'var(--bg-primary)',
                padding: '2px 8px',
                border: '1px solid var(--accent-green)',
              }}>
                {plan.badge}
              </span>
            )}

            <div className="flex items-center justify-between">
              <div>
                <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {plan.name}
                </h3>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
                  {plan.description}
                </p>
              </div>
              <div className="text-right">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {plan.price}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-tertiary)' }}>
                  {plan.interval}
                </span>
              </div>
            </div>

            <button
              onClick={() => handleCheckout(plan.id)}
              disabled={loading !== null}
              className="mt-4 w-full"
              style={{
                padding: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: loading === plan.id ? 'var(--text-tertiary)' : 'var(--text-primary)',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                cursor: loading !== null ? 'wait' : 'pointer',
                opacity: loading !== null && loading !== plan.id ? 0.3 : 1,
              }}
            >
              {loading === plan.id ? 'redirecting to stripe...' : 'subscribe'}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-red)' }}>
          {error}
        </p>
      )}

      <p className="mt-8 text-center" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
        Secure payment via Stripe. Cancel anytime.
      </p>
    </div>
  )
}
