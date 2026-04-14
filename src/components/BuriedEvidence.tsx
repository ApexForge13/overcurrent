"use client";

import { useState } from "react";

interface BuriedEvidenceItem {
  fact: string;
  reportedBy: string;
  contradicts: string;
  notPickedUpBy: string[];
  sourceType: string;
  whyItMatters: string;
}

interface BuriedEvidenceProps {
  items: BuriedEvidenceItem[];
  totalSourceCount?: number;
}

export function BuriedEvidence({ items, totalSourceCount }: BuriedEvidenceProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!items || items.length === 0) return null;

  return (
    <div>
      {items.map((item, i) => {
        const isExpanded = expandedIdx === i;
        return (
          <div
            key={i}
            style={{
              borderBottom: '1px solid var(--border-primary)',
              borderLeft: '3px solid var(--accent-red)',
              paddingLeft: '16px',
            }}
          >
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="w-full text-left py-4"
              style={{ cursor: 'pointer', background: 'none', border: 'none' }}
            >
              <div className="flex items-start gap-2">
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--accent-red)',
                  marginTop: '2px',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms ease',
                  display: 'inline-block',
                  flexShrink: 0,
                }}>
                  {"\u25B8"}
                </span>
                <div>
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    lineHeight: 1.4,
                  }}>
                    {item.fact}
                  </p>
                  <p className="mt-1" style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                  }}>
                    Reported by {item.reportedBy}{totalSourceCount ? ` — 1 of ${totalSourceCount} sources (${(100 / totalSourceCount).toFixed(1)}% coverage)` : ` — not found in ${item.notPickedUpBy.length} other outlet${item.notPickedUpBy.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div className="pb-4 pl-5" style={{ animation: 'fadeIn 200ms ease' }}>
                {/* What it contradicts */}
                <div className="mb-3">
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--accent-amber)',
                    letterSpacing: '0.04em',
                    marginBottom: '4px',
                  }}>
                    CONTRADICTS
                  </p>
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}>
                    {item.contradicts}
                  </p>
                </div>

                {/* Not picked up by */}
                <div className="mb-3">
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    letterSpacing: '0.04em',
                    marginBottom: '4px',
                  }}>
                    NOT FOUND IN
                  </p>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                  }}>
                    {item.notPickedUpBy.join(', ')}
                  </p>
                </div>

                {/* Source type */}
                <div className="mb-3">
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                  }}>
                    Source: {item.sourceType}
                  </p>
                </div>

                {/* Why it matters */}
                <div style={{
                  borderLeft: '2px solid var(--accent-blue)',
                  paddingLeft: '12px',
                }}>
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    fontStyle: 'italic',
                  }}>
                    {item.whyItMatters}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
