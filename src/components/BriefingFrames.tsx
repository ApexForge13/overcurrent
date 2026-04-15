"use client";

interface BriefingFrame {
  name: string;
  outlet_count: number;
  summary: string;
}

interface BriefingFramesProps {
  frames: BriefingFrame[];
}

export function BriefingFrames({ frames }: BriefingFramesProps) {
  if (!frames || frames.length === 0) return null;

  const display = frames.slice(0, 3);

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
          HOW THEY FRAMED IT
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary, #1E1E20)" }} />
      </div>

      {/* Frames */}
      <div>
        {display.map((frame, i) => (
          <div
            key={i}
            style={{
              borderBottom:
                i < display.length - 1
                  ? "1px solid var(--border-primary, #1E1E20)"
                  : "none",
              paddingBottom: i < display.length - 1 ? "14px" : "0",
              marginBottom: i < display.length - 1 ? "14px" : "0",
            }}
          >
            {/* Name + outlet count */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "6px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  fontWeight: 700,
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.04em",
                  color: "var(--text-primary, #E8E6E3)",
                }}
              >
                {frame.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--accent-teal, #2A9D8F)",
                  flexShrink: 0,
                  marginLeft: "12px",
                }}
              >
                {frame.outlet_count} outlets
              </span>
            </div>
            {/* Summary */}
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                lineHeight: 1.55,
                color: "var(--text-secondary, #9A9894)",
                margin: 0,
              }}
            >
              {frame.summary}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
