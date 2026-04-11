interface ThePatternProps {
  pattern: string;
  confidence?: string;
}

export function ThePattern({ pattern, confidence }: ThePatternProps) {
  if (!pattern) return null;

  const accentColor = confidence === 'HIGH' ? 'var(--accent-green)' :
    confidence === 'LOW' ? 'var(--accent-red)' : 'var(--accent-blue)';

  return (
    <div
      className="my-8"
      style={{
        borderLeft: `2px solid ${accentColor}`,
        background: 'var(--bg-tertiary)',
        padding: '20px 24px',
      }}
    >
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: '17px',
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        fontWeight: 500,
      }}>
        <span style={{ fontWeight: 700 }}>The pattern: </span>
        {pattern}
      </p>
    </div>
  );
}
