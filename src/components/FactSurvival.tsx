"use client";

import { useState } from "react";

interface FactSurvivalItem {
  fact: string;
  originLayer: string;
  survivedTo: string;
  diedAt: string;
  killPoint: string;
  whatWasLost: string;
  significance: string;
}

interface FactSurvivalProps {
  items: FactSurvivalItem[];
}

const LAYERS = ['on_scene', 'local', 'national', 'international'] as const;
const LAYER_LABELS: Record<string, string> = {
  on_scene: 'On scene',
  local: 'Local media',
  national: 'National media',
  international: 'International',
  survived_all: 'All layers',
};

const SIGNIFICANCE_COLORS: Record<string, string> = {
  HIGH: 'var(--accent-red)',
  MEDIUM: 'var(--accent-amber)',
  LOW: 'var(--text-tertiary)',
};

function getLayerIndex(layer: string): number {
  const idx = LAYERS.indexOf(layer as typeof LAYERS[number]);
  return idx >= 0 ? idx : -1;
}

export function FactSurvival({ items }: FactSurvivalProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!items || items.length === 0) return null;

  // Count facts surviving to each layer
  const survivingCounts = LAYERS.map((layer, layerIdx) => {
    return items.filter(item => {
      const survivedIdx = item.diedAt === 'survived_all' ? LAYERS.length : getLayerIndex(item.diedAt);
      return survivedIdx > layerIdx || (item.diedAt === 'survived_all');
    }).length;
  });

  const maxFacts = Math.max(...survivingCounts, items.length);

  return (
    <div>
      {/* Layer funnel visualization */}
      <div className="mb-6 space-y-1">
        {LAYERS.map((layer, i) => {
          const count = survivingCounts[i];
          const pct = (count / maxFacts) * 100;
          const died = i > 0 ? survivingCounts[i - 1] - count : 0;

          return (
            <div key={layer} className="flex items-center gap-3">
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-tertiary)',
                width: '100px',
                flexShrink: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                textAlign: 'right',
              }}>
                {LAYER_LABELS[layer]}
              </span>
              <div style={{ flex: 1, height: '12px', background: 'var(--border-primary)', position: 'relative' }}>
                <div style={{
                  width: `${Math.max(pct, 4)}%`,
                  height: '100%',
                  background: 'var(--accent-blue)',
                  transition: 'width 0.5s ease',
                  opacity: 0.7 + (0.3 * (1 - i / LAYERS.length)),
                }} />
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                width: '20px',
                flexShrink: 0,
              }}>
                {count}
              </span>
              {died > 0 && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--accent-red)',
                  flexShrink: 0,
                }}>
                  -{died}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Individual fact details */}
      <div>
        {items.map((item, i) => {
          const isExpanded = expandedIdx === i;
          const died = item.diedAt !== 'survived_all';
          const sigColor = SIGNIFICANCE_COLORS[item.significance] || 'var(--text-tertiary)';

          return (
            <div
              key={i}
              style={{
                borderBottom: '1px solid var(--border-primary)',
                borderLeft: `3px solid ${died ? sigColor : 'var(--accent-green)'}`,
                paddingLeft: '12px',
              }}
            >
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                className="w-full text-left py-3"
                style={{ cursor: 'pointer', background: 'none', border: 'none' }}
              >
                <div className="flex items-start gap-2">
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: sigColor,
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 200ms ease',
                    display: 'inline-block',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}>
                    ▸
                  </span>
                  <div>
                    <p style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: '13px',
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                    }}>
                      {item.fact}
                    </p>
                    <p className="mt-1" style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--text-tertiary)',
                    }}>
                      {died
                        ? `Died at ${LAYER_LABELS[item.diedAt] || item.diedAt} boundary`
                        : 'Survived all layers'}
                      {item.significance !== 'LOW' && ` · ${item.significance}`}
                    </p>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="pb-3 pl-5" style={{ animation: 'fadeIn 200ms ease' }}>
                  <div className="space-y-2">
                    <div className="flex gap-4" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>Origin: <span style={{ color: 'var(--text-secondary)' }}>{LAYER_LABELS[item.originLayer] || item.originLayer}</span></span>
                      <span style={{ color: 'var(--text-tertiary)' }}>Survived to: <span style={{ color: 'var(--text-secondary)' }}>{LAYER_LABELS[item.survivedTo] || item.survivedTo}</span></span>
                    </div>
                    {died && (
                      <>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-red)' }}>
                          Kill point: {item.killPoint}
                        </p>
                        <div style={{ borderLeft: '2px solid var(--accent-blue)', paddingLeft: '10px' }}>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>
                            {item.whatWasLost}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
