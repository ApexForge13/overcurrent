"use client";

import { useState } from "react";

interface VaultToggleProps {
  claimCount: number;
  frameCount: number;
  discrepancyCount: number;
  sourceCount: number;
  children: React.ReactNode;
}

export function VaultToggle({
  claimCount,
  frameCount,
  discrepancyCount,
  sourceCount,
  children,
}: VaultToggleProps) {
  const [isOpen, setIsOpen] = useState(false);

  const parts: string[] = [];
  if (claimCount > 0) parts.push(`${claimCount} claims`);
  if (frameCount > 0) parts.push(`${frameCount} framing analyses`);
  if (discrepancyCount > 0) parts.push(`${discrepancyCount} discrepancies`);
  if (sourceCount > 0) parts.push(`${sourceCount} sources`);
  const summaryText = parts.join(" \u00B7 ");

  return (
    <div>
      {/* Separator bar */}
      <div
        style={{
          background: "var(--bg-tertiary, #141416)",
          borderTop: "1px solid var(--border-primary, #1E1E20)",
          borderBottom: "1px solid var(--border-primary, #1E1E20)",
          padding: "16px 20px",
          margin: "36px 0 0 0",
        }}
      >
        {/* Summary line */}
        {summaryText && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text-secondary, #9A9894)",
              marginBottom: "10px",
            }}
          >
            {summaryText}
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            background: "none",
            border: "1px solid var(--border-primary, #1E1E20)",
            borderRadius: "3px",
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "var(--text-primary, #E8E6E3)",
            transition: "border-color 200ms ease",
          }}
        >
          {isOpen ? "\u25BE Hide Full Evidence" : "\u25B8 View Full Evidence"}
        </button>
      </div>

      {/* Expandable content */}
      {isOpen && (
        <div
          style={{
            borderLeft: "1px solid var(--border-primary, #1E1E20)",
            marginLeft: "4px",
            paddingLeft: "16px",
            paddingTop: "8px",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
