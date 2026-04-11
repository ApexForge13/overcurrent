'use client'

import { useState, useMemo } from 'react'
import { outlets, type OutletInfo } from '@/data/outlets'

const leanColors: Record<string, string> = {
  left: '#457B9D',
  'center-left': '#6A9FBD',
  center: '#9A9894',
  'center-right': '#D48A7B',
  right: '#E63946',
  'state-controlled': '#F4A261',
  unknown: '#5C5A56',
}

const reliabilityColors: Record<string, string> = {
  high: 'var(--accent-green)',
  medium: 'var(--accent-amber)',
  low: 'var(--accent-red)',
  mixed: 'var(--text-tertiary)',
}

function sortedOutlets(list: OutletInfo[]): OutletInfo[] {
  return [...list].sort((a, b) => {
    const regionCmp = a.region.localeCompare(b.region)
    if (regionCmp !== 0) return regionCmp
    return a.name.localeCompare(b.name)
  })
}

export default function OutletsPage() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return sortedOutlets(outlets)
    return sortedOutlets(
      outlets.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.country.toLowerCase().includes(q) ||
          o.region.toLowerCase().includes(q) ||
          o.type.toLowerCase().includes(q) ||
          o.politicalLean.toLowerCase().includes(q) ||
          o.language.toLowerCase().includes(q)
      )
    )
  }, [query])

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '48px 24px 96px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 36,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 8,
              letterSpacing: '-0.02em',
            }}
          >
            Outlet Registry
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--text-tertiary)',
            }}
          >
            {filtered.length} of {outlets.length} outlets
          </p>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search by name, country, region..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'var(--text-primary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            padding: '10px 16px',
            width: 320,
            maxWidth: '100%',
            outline: 'none',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
          }}
        >
          <thead>
            <tr>
              {['Name', 'Country', 'Region', 'Type', 'Lean', 'Reliability', 'Language'].map(
                (col) => (
                  <th
                    key={col}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase' as const,
                      color: 'var(--text-tertiary)',
                      textAlign: 'left',
                      padding: '12px 12px 12px 0',
                      borderBottom: '2px solid var(--border-primary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((outlet, i) => (
              <tr
                key={`${outlet.domain}-${i}`}
                style={{
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {outlet.name}
                </td>
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {outlet.country}
                </td>
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {outlet.region}
                </td>
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  {outlet.type}
                </td>
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: leanColors[outlet.politicalLean] ?? 'var(--text-tertiary)',
                  }}
                >
                  {outlet.politicalLean}
                </td>
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 500,
                    color: reliabilityColors[outlet.reliability] ?? 'var(--text-tertiary)',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  {outlet.reliability}
                </td>
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {outlet.language}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            padding: '48px 0',
          }}
        >
          No outlets match your search.
        </p>
      )}
    </div>
  )
}
