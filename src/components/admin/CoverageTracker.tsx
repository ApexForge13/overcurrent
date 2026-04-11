"use client";

import { useState, useEffect } from "react";

const CATEGORIES = [
  { slug: 'conflict', label: 'Conflict', color: '#E63946' },
  { slug: 'politics', label: 'Politics', color: '#457B9D' },
  { slug: 'economy', label: 'Economy', color: '#2A9D8F' },
  { slug: 'tech', label: 'Tech', color: '#7B68EE' },
  { slug: 'labor', label: 'Labor', color: '#F4A261' },
  { slug: 'climate', label: 'Climate', color: '#2A9D8F' },
  { slug: 'health', label: 'Health', color: '#457B9D' },
  { slug: 'society', label: 'Society', color: '#F4A261' },
  { slug: 'trade', label: 'Trade', color: '#457B9D' },
]

interface CategoryCount {
  category: string
  count: number
}

export function CoverageTracker() {
  const [data, setData] = useState<CategoryCount[]>([])
  const [totalStories, setTotalStories] = useState(0)

  useEffect(() => {
    fetch('/api/admin/stories?limit=200')
      .then(r => r.json())
      .then(result => {
        const stories = result.stories || []
        setTotalStories(stories.length)

        // Count by category
        const counts: Record<string, number> = {}
        CATEGORIES.forEach(c => counts[c.slug] = 0)

        for (const story of stories) {
          const cat = story.primaryCategory || 'society'
          if (counts[cat] !== undefined) counts[cat]++
          else counts['society']++
        }

        setData(CATEGORIES.map(c => ({ category: c.slug, count: counts[c.slug] || 0 })))
      })
      .catch(() => {})
  }, [])

  if (totalStories === 0) return null

  const maxCount = Math.max(...data.map(d => d.count), 1)
  const avgCount = totalStories / CATEGORIES.length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
          Coverage Balance
        </h3>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {totalStories} total stories
        </span>
      </div>

      <div className="space-y-2">
        {data.map(d => {
          const cat = CATEGORIES.find(c => c.slug === d.category)!
          const pct = (d.count / maxCount) * 100
          const isUnderserved = d.count < avgCount * 0.5
          const isOverserved = d.count > avgCount * 2

          return (
            <div key={d.category} className="flex items-center gap-3">
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: isUnderserved ? 'var(--accent-red)' : 'var(--text-secondary)',
                width: '70px',
                flexShrink: 0,
                textTransform: 'capitalize',
              }}>
                {cat.label}
              </span>

              <div style={{ flex: 1, height: '8px', background: 'var(--border-primary)', position: 'relative' }}>
                <div style={{
                  width: `${Math.max(pct, 2)}%`,
                  height: '100%',
                  background: cat.color,
                  transition: 'width 0.5s ease',
                }} />
              </div>

              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                width: '24px',
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {d.count}
              </span>

              {isUnderserved && d.count === 0 && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--accent-red)',
                  letterSpacing: '0.06em',
                  flexShrink: 0,
                }}>
                  NONE
                </span>
              )}
              {isUnderserved && d.count > 0 && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--accent-amber)',
                  letterSpacing: '0.06em',
                  flexShrink: 0,
                }}>
                  LOW
                </span>
              )}
              {isOverserved && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.06em',
                  flexShrink: 0,
                }}>
                  HIGH
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
