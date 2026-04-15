"use client";

interface LobbyProps {
  headline: string;
  pattern: string;
  summary: string;
  confidenceLevel: string;
  confidenceScore: number;
  category: string;
  sourceCount: number;
  outletCount: number;
  countryCount: number;
  modelCount: number;
  publishedAt: string;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: "var(--accent-green, #00F5A0)",
  MEDIUM: "var(--accent-amber, #F4A261)",
  LOW: "var(--accent-red, #E24B4A)",
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function Lobby({
  headline,
  pattern,
  summary,
  confidenceLevel,
  confidenceScore,
  category,
  sourceCount,
  outletCount,
  countryCount,
  modelCount,
  publishedAt,
}: LobbyProps) {
  if (!headline) return null;

  const barColor = CONFIDENCE_COLORS[confidenceLevel] || CONFIDENCE_COLORS.MEDIUM;
  const clampedScore = Math.max(0, Math.min(100, confidenceScore));

  return (
    <div style={{ maxWidth: "780px" }}>
      {/* Disclaimer */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          letterSpacing: "0.04em",
          color: "var(--text-tertiary, #5C5A56)",
          marginBottom: "24px",
        }}
      >
        Coverage analysis, not journalism. We could be wrong.
      </div>

      {/* Confidence bar */}
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "6px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              color: barColor,
            }}
          >
            {confidenceLevel} confidence
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-tertiary, #5C5A56)",
            }}
          >
            {clampedScore}%
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: "4px",
            background: "var(--border-primary, #1E1E20)",
            borderRadius: "2px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${clampedScore}%`,
              height: "100%",
              background: barColor,
              borderRadius: "2px",
              transition: "width 0.6s ease",
            }}
          />
        </div>
      </div>

      {/* Category badge */}
      {category && (
        <div
          style={{
            display: "inline-block",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            color: "var(--accent-teal, #2A9D8F)",
            border: "1px solid var(--accent-teal, #2A9D8F)",
            borderRadius: "3px",
            padding: "3px 10px",
            marginBottom: "16px",
          }}
        >
          {category}
        </div>
      )}

      {/* Headline */}
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "36px",
          fontWeight: 700,
          lineHeight: 1.15,
          color: "var(--text-primary, #E8E6E3)",
          margin: "0 0 16px 0",
        }}
      >
        {headline}
      </h1>

      {/* Stats bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap" as const,
          gap: "6px 20px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-secondary, #9A9894)",
          marginBottom: "28px",
        }}
      >
        <span>
          {sourceCount.toLocaleString()} sources &middot;{" "}
          {outletCount.toLocaleString()} outlets &middot;{" "}
          {countryCount.toLocaleString()} countries
        </span>
        <span>
          {modelCount} AI models &middot; Published {formatDate(publishedAt)}
        </span>
      </div>

      {/* THE PATTERN box */}
      {pattern && (
        <div
          style={{
            background: "var(--bg-tertiary, #141416)",
            borderLeft: "2px solid var(--accent-teal, #2A9D8F)",
            padding: "20px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: "var(--accent-teal, #2A9D8F)",
              marginBottom: "10px",
            }}
          >
            THE PATTERN
          </div>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "17px",
              lineHeight: 1.55,
              color: "var(--text-primary, #E8E6E3)",
              margin: 0,
            }}
          >
            {pattern}
          </p>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "16px",
            lineHeight: 1.65,
            color: "var(--text-primary, #E8E6E3)",
            maxWidth: "680px",
            margin: "0 0 40px 0",
          }}
        >
          {summary}
        </p>
      )}

      {/* Scroll indicator */}
      <div
        style={{
          textAlign: "center" as const,
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          color: "var(--text-tertiary, #5C5A56)",
          paddingBottom: "12px",
          animation: "lobbyBounce 2s ease-in-out infinite",
        }}
      >
        &#9660; KEEP READING
        <style>{`
          @keyframes lobbyBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(6px); }
          }
        `}</style>
      </div>
    </div>
  );
}
