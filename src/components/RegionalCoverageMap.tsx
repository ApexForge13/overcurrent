interface RegionCoverage {
  region: string;
  source_count: number;
  coverage_level: string;
  notes?: string | null;
}

interface RegionalCoverageMapProps {
  regions: RegionCoverage[];
  silenceExplanation?: string;
}

export function RegionalCoverageMap({ regions, silenceExplanation }: RegionalCoverageMapProps) {
  const maxCount = Math.max(...regions.map(r => r.source_count), 1);

  return (
    <div>
      <div className="space-y-3">
        {regions.map((r) => {
          const pct = (r.source_count / maxCount) * 100;
          const isSilent = r.source_count === 0;

          return (
            <div key={r.region} className="flex items-center gap-4">
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 600,
                color: isSilent ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                width: '140px',
                flexShrink: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {r.region}
              </span>
              <div style={{ flex: 1, height: '8px', background: 'var(--border-primary)', position: 'relative' }}>
                {r.source_count > 0 && (
                  <div
                    style={{
                      width: `${Math.max(pct, 3)}%`,
                      height: '100%',
                      background: 'var(--accent-blue)',
                      transition: 'width 0.8s ease-out',
                    }}
                  />
                )}
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: isSilent ? 'var(--text-tertiary)' : 'var(--text-primary)',
                width: '36px',
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {r.source_count}
              </span>
            </div>
          );
        })}
      </div>

      {silenceExplanation && (
        <p className="mt-4" style={{
          fontFamily: 'var(--font-body)',
          fontSize: '13px',
          color: 'var(--text-tertiary)',
          lineHeight: 1.6,
          fontStyle: 'italic',
        }}>
          {silenceExplanation}
        </p>
      )}
    </div>
  );
}
