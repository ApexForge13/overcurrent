"use client";

interface BriefingMissedItem {
  finding: string;
  coverage: string;
  outlets: string[];
}

interface BriefingMissedProps {
  items: BriefingMissedItem[];
}

export function BriefingMissed({ items }: BriefingMissedProps) {
  if (!items || items.length === 0) return null;

  const display = items.slice(0, 3);

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
          WHAT THE WORLD MISSED
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary, #1E1E20)" }} />
      </div>

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "16px" }}>
        {display.map((item, i) => (
          <div
            key={i}
            style={{
              borderLeft: "2px solid var(--accent-red, #E24B4A)",
              paddingLeft: "14px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "16px",
                lineHeight: 1.55,
                color: "var(--text-primary, #E8E6E3)",
                margin: "0 0 6px 0",
              }}
            >
              {item.finding}
            </p>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--text-secondary, #9A9894)",
                margin: 0,
              }}
            >
              {item.coverage}
              {item.outlets && item.outlets.length > 0 && (
                <> &middot; {item.outlets.join(", ")}</>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
