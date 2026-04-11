'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MAP_REGIONS,
  PROPAGATION_STATUS,
  type MapRegion,
  type PropagationStatusType,
} from '@/data/map-regions'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TimelineFrame {
  hour: number
  label: string
  description: string
  regions: Array<{
    region_id: string
    status: string
    coverage_volume: number
    dominant_quote: string
    outlet_count: number
    key_outlets: string[]
  }>
  flows: Array<{
    from: string
    to: string
    type: string
  }>
}

interface PropagationMapProps {
  timeline: TimelineFrame[]
  storyHeadline: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const regionMap = new Map<string, MapRegion>(
  MAP_REGIONS.map((r) => [r.id, r])
)

function getBezierControl(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return { cx: mx, cy: my }
  const offset = len * 0.2
  return { cx: mx - (dy / len) * offset, cy: my + (dx / len) * offset }
}

function statusColor(status: string): string {
  const s = PROPAGATION_STATUS[status as PropagationStatusType]
  return s ? s.color : PROPAGATION_STATUS.silent.color
}

function statusLabel(status: string): string {
  const s = PROPAGATION_STATUS[status as PropagationStatusType]
  return s ? s.label : status
}

/* ------------------------------------------------------------------ */
/*  Continent background paths                                        */
/* ------------------------------------------------------------------ */

const CONTINENT_PATHS = [
  // North America
  'M100,80 L200,70 L220,120 L200,160 L180,200 L160,220 L140,240 L120,220 L100,180 Z',
  // South America
  'M160,260 L200,250 L220,280 L210,330 L190,360 L170,350 L155,310 L160,280 Z',
  // Europe
  'M310,100 L380,90 L400,120 L390,160 L370,180 L340,170 L320,140 Z',
  // Africa
  'M340,200 L400,190 L420,230 L410,300 L380,340 L350,320 L330,270 L340,230 Z',
  // Asia
  'M420,80 L560,70 L600,120 L580,180 L540,200 L500,220 L460,210 L430,180 L420,130 Z',
  // Australia
  'M560,290 L620,280 L640,310 L620,340 L580,345 L560,320 Z',
]

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PropagationMap({ timeline, storyHeadline }: PropagationMapProps) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ---- empty state ---- */
  if (!timeline || timeline.length < 3) {
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          color: 'var(--text-tertiary, #737373)',
          padding: '48px 24px',
          textAlign: 'center',
          background: '#111111',
          border: '1px solid #1e1e1e',
          borderRadius: '8px',
        }}
      >
        This story had limited international propagation...
      </div>
    )
  }

  const frame = timeline[frameIdx]
  const activeRegions = new Map(
    frame.regions.map((r) => [r.region_id, r])
  )

  /* ---- playback ---- */
  const tick = useCallback(() => {
    setFrameIdx((prev) => (prev + 1) % timeline.length)
  }, [timeline.length])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(tick, 2500)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [playing, tick])

  const togglePlay = () => setPlaying((p) => !p)

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaying(false)
    setFrameIdx(Number(e.target.value))
  }

  /* ---- selected region info ---- */
  const selectedData = selectedRegionId ? activeRegions.get(selectedRegionId) : null
  const selectedMeta = selectedRegionId ? regionMap.get(selectedRegionId) : null

  /* ---- mutation bars: active regions sorted by coverage_volume desc ---- */
  const sortedRegions = [...frame.regions]
    .filter((r) => r.status !== 'silent')
    .sort((a, b) => b.coverage_volume - a.coverage_volume)
  const maxVolume = Math.max(...sortedRegions.map((r) => r.coverage_volume), 1)

  /* ---- render ---- */
  return (
    <div
      style={{
        background: '#0D0D10',
        border: '1px solid #1e1e1e',
        borderRadius: '10px',
        padding: '20px',
        fontFamily: 'var(--font-mono, "IBM Plex Mono", monospace)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: '#5C5A56',
            marginBottom: '4px',
          }}
        >
          Story Propagation
        </div>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#E8E4DE',
            lineHeight: 1.3,
            marginBottom: '4px',
          }}
        >
          {storyHeadline}
        </div>
        <div
          style={{
            fontSize: '11px',
            color: '#7A7870',
            lineHeight: 1.4,
          }}
        >
          {frame.label} &mdash; {frame.description}
        </div>
      </div>

      {/* SVG Map */}
      <svg
        viewBox="0 0 680 400"
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          borderRadius: '6px',
          background: '#111114',
        }}
      >
        {/* Continent shapes */}
        {CONTINENT_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="#1A1A1E"
            stroke="#2A2A2E"
            strokeWidth="1"
          />
        ))}

        {/* Flow lines */}
        {frame.flows.map((flow, i) => {
          const from = regionMap.get(flow.from)
          const to = regionMap.get(flow.to)
          if (!from || !to) return null
          const ctrl = getBezierControl(from.x, from.y, to.x, to.y)
          const flowColor = statusColor(flow.type)
          return (
            <g key={`flow-${i}`}>
              <path
                d={`M${from.x},${from.y} Q${ctrl.cx},${ctrl.cy} ${to.x},${to.y}`}
                fill="none"
                stroke={flowColor}
                strokeWidth="1.5"
                strokeOpacity="0.45"
                strokeDasharray="4 3"
                style={{ transition: 'all 200ms ease' }}
              />
              {/* Arrow head */}
              <circle
                cx={to.x}
                cy={to.y}
                r={3}
                fill={flowColor}
                fillOpacity={0.6}
                style={{ transition: 'all 200ms ease' }}
              />
            </g>
          )
        })}

        {/* Region nodes */}
        {MAP_REGIONS.map((region) => {
          const data = activeRegions.get(region.id)
          const status = data ? data.status : 'silent'
          const color = statusColor(status)
          const isActive = status !== 'silent'
          const isSelected = selectedRegionId === region.id
          const pulseRadius = isActive ? region.radius + 4 : 0

          return (
            <g
              key={region.id}
              style={{ cursor: 'pointer', transition: 'all 200ms ease' }}
              onClick={() =>
                setSelectedRegionId(
                  selectedRegionId === region.id ? null : region.id
                )
              }
            >
              {/* Pulse ring for active regions */}
              {isActive && (
                <circle
                  cx={region.x}
                  cy={region.y}
                  r={pulseRadius}
                  fill="none"
                  stroke={color}
                  strokeWidth="1"
                  strokeOpacity="0.25"
                  style={{ transition: 'all 200ms ease' }}
                />
              )}

              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={region.x}
                  cy={region.y}
                  r={region.radius + 7}
                  fill="none"
                  stroke="#E8E4DE"
                  strokeWidth="1"
                  strokeOpacity="0.5"
                  strokeDasharray="2 2"
                />
              )}

              {/* Main circle */}
              <circle
                cx={region.x}
                cy={region.y}
                r={isActive ? region.radius : Math.max(region.radius * 0.4, 4)}
                fill={color}
                fillOpacity={isActive ? 0.85 : 0.3}
                stroke={color}
                strokeWidth={isActive ? 1.5 : 0.5}
                strokeOpacity={isActive ? 0.9 : 0.4}
                style={{ transition: 'all 200ms ease' }}
              />

              {/* Label */}
              <text
                x={region.x}
                y={region.y + region.radius + 12}
                textAnchor="middle"
                fill={isActive ? '#B0ADA5' : '#4A4A4A'}
                fontSize="8"
                fontFamily="var(--font-mono, monospace)"
                fontWeight={isActive ? 600 : 400}
                style={{ transition: 'fill 200ms ease' }}
              >
                {region.label}
              </text>

              {/* Outlet count badge */}
              {isActive && data && data.outlet_count > 0 && (
                <text
                  x={region.x}
                  y={region.y + 3.5}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="9"
                  fontWeight={700}
                  fontFamily="var(--font-mono, monospace)"
                >
                  {data.outlet_count}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Timeline controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginTop: '12px',
          padding: '8px 0',
        }}
      >
        <button
          onClick={togglePlay}
          style={{
            background: 'none',
            border: '1px solid #2A2A2E',
            borderRadius: '4px',
            color: '#B0ADA5',
            fontSize: '12px',
            padding: '4px 10px',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono, monospace)',
            flexShrink: 0,
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '||' : '\u25B6'}
        </button>
        <input
          type="range"
          min={0}
          max={timeline.length - 1}
          value={frameIdx}
          onChange={handleSlider}
          style={{
            flex: 1,
            accentColor: '#2A9D8F',
            height: '4px',
          }}
        />
        <span
          style={{
            fontSize: '10px',
            color: '#5C5A56',
            fontFamily: 'var(--font-mono, monospace)',
            flexShrink: 0,
            minWidth: '60px',
            textAlign: 'right',
          }}
        >
          +{frame.hour}h
        </span>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '14px',
          marginTop: '8px',
          paddingBottom: '12px',
          borderBottom: '1px solid #1e1e1e',
        }}
      >
        {Object.entries(PROPAGATION_STATUS).map(([key, val]) => (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: val.color,
              }}
            />
            <span
              style={{
                fontSize: '10px',
                color: '#7A7870',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              {val.label}
            </span>
          </div>
        ))}
      </div>

      {/* Mutation bars */}
      {sortedRegions.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <div
            style={{
              fontSize: '9px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#5C5A56',
              marginBottom: '10px',
            }}
          >
            Coverage volume
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedRegions.map((r) => {
              const meta = regionMap.get(r.region_id)
              const pct = (r.coverage_volume / maxVolume) * 100
              const color = statusColor(r.status)
              return (
                <div key={r.region_id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '2px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#B0ADA5',
                        width: '110px',
                        flexShrink: 0,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >
                      {meta?.label ?? r.region_id}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: '6px',
                        background: '#1A1A1E',
                        borderRadius: '3px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: color,
                          borderRadius: '3px',
                          transition: 'width 200ms ease',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: '9px',
                        color: '#5C5A56',
                        fontFamily: 'var(--font-mono, monospace)',
                        minWidth: '28px',
                        textAlign: 'right',
                      }}
                    >
                      {r.coverage_volume}
                    </span>
                  </div>
                  {r.dominant_quote && (
                    <div
                      style={{
                        fontSize: '10px',
                        fontStyle: 'italic',
                        color: '#5C5A56',
                        marginLeft: '118px',
                        lineHeight: 1.3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 'calc(100% - 146px)',
                      }}
                    >
                      &ldquo;{r.dominant_quote}&rdquo;
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Region info panel */}
      {selectedRegionId && selectedMeta && (
        <div
          style={{
            marginTop: '16px',
            padding: '14px 16px',
            background: '#141418',
            border: '1px solid #2A2A2E',
            borderRadius: '8px',
            transition: 'all 200ms ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#E8E4DE',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {selectedMeta.label}
              </span>
              {selectedData && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: statusColor(selectedData.status),
                    fontFamily: 'var(--font-mono, monospace)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: statusColor(selectedData.status),
                    }}
                  />
                  {statusLabel(selectedData.status)}
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedRegionId(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#5C5A56',
                fontSize: '14px',
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
              }}
              aria-label="Close panel"
            >
              x
            </button>
          </div>

          <div
            style={{
              fontSize: '10px',
              color: '#7A7870',
              marginBottom: '6px',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {frame.label}
          </div>

          {selectedData ? (
            <>
              {selectedData.dominant_quote && (
                <div
                  style={{
                    fontSize: '12px',
                    fontStyle: 'italic',
                    color: '#B0ADA5',
                    lineHeight: 1.45,
                    marginBottom: '8px',
                    borderLeft: `2px solid ${statusColor(selectedData.status)}`,
                    paddingLeft: '10px',
                  }}
                >
                  &ldquo;{selectedData.dominant_quote}&rdquo;
                </div>
              )}

              {selectedData.key_outlets.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    marginBottom: '6px',
                  }}
                >
                  {selectedData.key_outlets.map((outlet) => (
                    <span
                      key={outlet}
                      style={{
                        fontSize: '9px',
                        fontWeight: 500,
                        color: '#7A7870',
                        background: '#1A1A1E',
                        border: '1px solid #2A2A2E',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >
                      {outlet}
                    </span>
                  ))}
                </div>
              )}

              <div
                style={{
                  fontSize: '10px',
                  color: '#5C5A56',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {selectedData.outlet_count} outlet{selectedData.outlet_count !== 1 ? 's' : ''} &middot; volume {selectedData.coverage_volume}
              </div>

              {selectedData.status === 'contradicted' && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 10px',
                    background: 'rgba(230, 57, 70, 0.08)',
                    border: '1px solid rgba(230, 57, 70, 0.2)',
                    borderRadius: '4px',
                    fontSize: '10px',
                    color: '#E63946',
                    fontFamily: 'var(--font-mono, monospace)',
                    lineHeight: 1.4,
                  }}
                >
                  This region&apos;s dominant narrative contradicts the original framing.
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                fontSize: '11px',
                color: '#5C5A56',
                fontStyle: 'italic',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              No coverage in this region at this time.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
