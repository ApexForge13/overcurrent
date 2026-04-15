"use client";

interface BriefingDisputeProps {
  question: string;
  sideA: string;
  sideACount: string;
  sideB: string;
  sideBCount: string;
  resolution: string;
}

export function BriefingDispute({
  question,
  sideA,
  sideACount,
  sideB,
  sideBCount,
  resolution,
}: BriefingDisputeProps) {
  if (!question && !sideA && !sideB) return null;

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
          THE KEY DISPUTE
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary, #1E1E20)" }} />
      </div>

      {/* Question */}
      {question && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "17px",
            fontStyle: "italic",
            lineHeight: 1.55,
            color: "var(--text-primary, #E8E6E3)",
            margin: "0 0 20px 0",
          }}
        >
          {question}
        </p>
      )}

      {/* Sides */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: "16px", marginBottom: "20px" }}>
        {/* Side A */}
        {sideA && (
          <div
            style={{
              borderLeft: "2px solid var(--accent-blue, #378ADD)",
              paddingLeft: "14px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                lineHeight: 1.55,
                color: "var(--text-primary, #E8E6E3)",
                margin: "0 0 6px 0",
              }}
            >
              {sideA}
            </p>
            {sideACount && (
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--text-secondary, #9A9894)",
                  margin: 0,
                }}
              >
                including {sideACount}
              </p>
            )}
          </div>
        )}

        {/* Side B */}
        {sideB && (
          <div
            style={{
              borderLeft: "2px solid var(--accent-amber, #F4A261)",
              paddingLeft: "14px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                lineHeight: 1.55,
                color: "var(--text-primary, #E8E6E3)",
                margin: "0 0 6px 0",
              }}
            >
              {sideB}
            </p>
            {sideBCount && (
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--text-secondary, #9A9894)",
                  margin: 0,
                }}
              >
                including {sideBCount}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Resolution */}
      {resolution && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "15px",
            lineHeight: 1.55,
            color: "var(--text-primary, #E8E6E3)",
            margin: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "var(--accent-teal, #2A9D8F)",
            }}
          >
            Overcurrent:
          </span>{" "}
          {resolution}
        </p>
      )}
    </div>
  );
}
