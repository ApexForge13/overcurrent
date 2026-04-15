"use client";

interface BriefingFactsProps {
  onScene: number;
  national: number;
  international: number;
  diedNational: string;
  diedInternational: string;
}

export function BriefingFacts({
  onScene,
  national,
  international,
  diedNational,
  diedInternational,
}: BriefingFactsProps) {
  if (onScene === 0 && national === 0 && international === 0) return null;

  const maxCount = Math.max(onScene, national, international, 1);
  const droppedNational = onScene - national;
  const droppedInternational = national - international;

  const bars = [
    { label: "ON SCENE", count: onScene, dropped: 0 },
    { label: "NATIONAL", count: national, dropped: droppedNational },
    { label: "INTERNATIONAL", count: international, dropped: droppedInternational },
  ];

  return (
    <div>
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          margin: "32px 0 20px 0",
        }}
      >
        <div style={{ width: "16px", height: "1px", background: "var(--border-primary, #1E1E20)" }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            color: "var(--text-tertiary, #5C5A56)",
            whiteSpace: "nowrap" as const,
          }}
        >
          WHAT DIED
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary, #1E1E20)" }} />
      </div>

      {/* Funnel bars */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "8px", marginBottom: "20px" }}>
        {bars.map((bar, i) => {
          const pct = (bar.count / maxCount) * 100;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                  color: "var(--text-tertiary, #5C5A56)",
                  width: "100px",
                  flexShrink: 0,
                  textAlign: "right" as const,
                }}
              >
                {bar.label}
              </span>
              <div style={{ flex: 1, height: "14px", position: "relative" as const }}>
                <div
                  style={{
                    width: `${Math.max(pct, 4)}%`,
                    height: "100%",
                    background: "var(--accent-teal, #2A9D8F)",
                    opacity: 1 - i * 0.2,
                    borderRadius: "1px",
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text-primary, #E8E6E3)",
                  width: "30px",
                  flexShrink: 0,
                }}
              >
                {bar.count}
              </span>
              {bar.dropped > 0 && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--accent-red, #E24B4A)",
                    flexShrink: 0,
                  }}
                >
                  -{bar.dropped}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Died-at descriptions */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "12px" }}>
        {diedNational && (
          <div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase" as const,
                color: "var(--accent-red, #E24B4A)",
              }}
            >
              DIED AT NATIONAL:
            </span>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                lineHeight: 1.55,
                color: "var(--text-secondary, #9A9894)",
                margin: "4px 0 0 0",
              }}
            >
              {diedNational}
            </p>
          </div>
        )}
        {diedInternational && (
          <div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase" as const,
                color: "var(--accent-red, #E24B4A)",
              }}
            >
              DIED AT INTERNATIONAL:
            </span>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                lineHeight: 1.55,
                color: "var(--text-secondary, #9A9894)",
                margin: "4px 0 0 0",
              }}
            >
              {diedInternational}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
