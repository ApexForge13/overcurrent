export default function NotFound() {
  return (
    <div className="max-w-[480px] mx-auto px-6 py-32 text-center">
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '48px',
        fontWeight: 700,
        color: 'var(--text-primary)',
        marginBottom: '12px',
      }}>
        404
      </h1>
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: '15px',
        color: 'var(--text-tertiary)',
        marginBottom: '32px',
      }}>
        This page doesn't exist. The story may have been archived or the URL may be wrong.
      </p>
      <a
        href="/"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          padding: '10px 24px',
          textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        back to overcurrent
      </a>
    </div>
  )
}
