export default function SubscribePage() {
  return (
    <div className="max-w-[480px] mx-auto px-6 py-20 text-center">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
        Subscribe to Overcurrent
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.6 }}>
        Every outlet shows you their version. We show you everyone&apos;s. Full access to all analyses, framing splits, discourse gaps, and propagation maps.
      </p>

      <div style={{ border: '1px solid var(--border-primary)', padding: '24px', marginBottom: '16px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '0.08em', marginBottom: '8px' }}>MONTHLY</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)' }}>$4.99<span style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>/mo</span></p>
      </div>

      <div style={{ border: '1px solid var(--border-primary)', padding: '24px', marginBottom: '16px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '0.08em', marginBottom: '8px' }}>ANNUAL (save 33%)</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)' }}>$39.99<span style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>/yr</span></p>
      </div>

      <div style={{ border: '1px solid var(--accent-green)', padding: '24px', marginBottom: '32px', background: 'rgba(42,157,143,0.05)' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-green)', letterSpacing: '0.08em', marginBottom: '8px' }}>FOUNDING MEMBER (first 500)</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)' }}>$3.99<span style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>/mo forever</span></p>
      </div>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
        Stripe integration coming soon. Email connermhecht13@gmail.com for early access.
      </p>
    </div>
  )
}
