"use client";

interface BriefingWatchProps {
  questions: string[];
}

export function BriefingWatch({ questions }: BriefingWatchProps) {
  if (!questions || questions.length === 0) return null;

  const display = questions.slice(0, 3);

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
          WHAT TO WATCH
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary, #1E1E20)" }} />
      </div>

      {/* Numbered list */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "12px" }}>
        {display.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-tertiary, #5C5A56)",
                flexShrink: 0,
                width: "20px",
              }}
            >
              {i + 1}.
            </span>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "16px",
                lineHeight: 1.55,
                color: "var(--text-primary, #E8E6E3)",
                margin: 0,
              }}
            >
              {q}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
