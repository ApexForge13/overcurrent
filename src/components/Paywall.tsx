"use client";

import { SIGNUP_FREE_READS } from "@/lib/paywall";

interface PaywallProps {
  readCount: number;
  isLoggedIn: boolean;
}

export function Paywall({ readCount, isLoggedIn }: PaywallProps) {
  return (
    <div style={{ position: 'relative' }}>
      {/* Gradient overlay */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '300px',
        background: 'linear-gradient(transparent, var(--bg-primary) 70%)',
        pointerEvents: 'none',
        zIndex: 10,
      }} />

      {/* Paywall card */}
      <div style={{
        position: 'relative',
        zIndex: 20,
        maxWidth: '480px',
        margin: '0 auto',
        padding: '40px 32px',
        textAlign: 'center',
      }}>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '16px',
        }}>
          {readCount} of {SIGNUP_FREE_READS} free reads used
        </p>

        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '28px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          lineHeight: 1.2,
          marginBottom: '12px',
        }}>
          You&apos;ve read your {SIGNUP_FREE_READS} free analyses
        </h2>

        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: '15px',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          marginBottom: '24px',
        }}>
          Every outlet shows you their version. We show you everyone&apos;s. Subscribe to keep seeing what&apos;s under the surface.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <a
            href={isLoggedIn ? '/subscribe' : '/signup'}
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--bg-primary)',
              background: 'var(--text-primary)',
              padding: '12px 32px',
              textDecoration: 'none',
              letterSpacing: '0.04em',
            }}
          >
            {isLoggedIn ? 'subscribe — $4.99/mo' : 'sign up free'}
          </a>
        </div>

        {!isLoggedIn && (
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
          }}>
            Already have an account? <a href="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Sign in</a>
          </p>
        )}

        <div className="mt-8" style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            lineHeight: 1.6,
          }}>
            $4.99/mo or $39.99/yr — Founding members: $3.99/mo locked for life (first 500)
          </p>
        </div>
      </div>
    </div>
  );
}
