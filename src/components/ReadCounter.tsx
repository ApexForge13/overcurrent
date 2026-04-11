interface ReadCounterProps {
  remaining: number;
  total: number;
}

export function ReadCounter({ remaining, total }: ReadCounterProps) {
  if (remaining > 5) return null; // Don't show until they're getting close

  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      color: remaining <= 2 ? 'var(--accent-red)' : 'var(--accent-amber)',
      textAlign: 'center',
      padding: '6px 0',
      borderBottom: '1px solid var(--border-primary)',
      letterSpacing: '0.04em',
    }}>
      {remaining === 0
        ? 'No free reads remaining'
        : `${remaining} of ${total} free reads remaining`}
    </div>
  );
}
