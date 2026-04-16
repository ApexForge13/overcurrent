"use client"

import React from "react"

/* ── Types ── */

interface DiscourseGapProps {
  gap: {
    mediaDominantFrame: string
    mediaFramePct: number
    publicDominantFrame: string
    publicFramePct: number
    gapScore: number
    gapDirection: string
    gapSummary: string
    publicSurfacedFirst?: string | null
    mediaIgnoredByPublic?: string | null
    publicCounterNarrative?: string | null
  }
  posts?: Array<{
    platform: string
    url?: string | null
    author?: string | null
    subreddit?: string | null
    content: string
    upvotes: number
    comments: number
    shares?: number | null
    views?: number | null
    authorFollowers?: number | null
    isVerified?: boolean
    framingType?: string | null
    sentiment?: string | null
  }>
}

/* ── Constants ── */

const FRAMING_COLORS: Record<string, string> = {
  crime: "var(--accent-red)",
  labor: "var(--accent-amber)",
  financial: "var(--accent-blue)",
  solidarity: "var(--accent-green)",
  outrage: "var(--accent-red)",
  humor: "var(--accent-purple)",
  skepticism: "var(--accent-amber)",
  counter_narrative: "var(--accent-purple)",
  conspiracy: "var(--accent-red)",
  indifference: "var(--text-tertiary)",
}

function getFramingColor(frame: string): string {
  const key = frame.toLowerCase().replace(/[\s-]/g, "_")
  return FRAMING_COLORS[key] || "var(--text-tertiary)"
}

function toTitleCase(str: string): string {
  return str.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
}

function getDirectionColor(direction: string): string {
  const d = direction.toLowerCase()
  if (d === "aligned") return "var(--accent-green)"
  if (d === "opposed") return "var(--accent-red)"
  return "var(--accent-amber)"
}

function parseJsonArray(value: string | unknown[] | null | undefined): unknown[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value as string)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

/* ── Styles ── */

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" }
const body: React.CSSProperties = { fontFamily: "var(--font-body)" }
const display: React.CSSProperties = { fontFamily: "var(--font-display)" }

/* ── Component ── */

export function DiscourseGap({ gap, posts }: DiscourseGapProps) {
  const surfacedFirst = parseJsonArray(gap.publicSurfacedFirst)
  // mediaIgnored items may be strings OR objects — normalize to strings
  const mediaIgnored = parseJsonArray(gap.mediaIgnoredByPublic).map(item => {
    if (typeof item === 'string') return item
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>
      return String(obj.insight || obj.finding || obj.text || JSON.stringify(item))
    }
    return String(item)
  })
  const directionColor = getDirectionColor(gap.gapDirection)
  const mediaColor = getFramingColor(gap.mediaDominantFrame)
  const publicColor = getFramingColor(gap.publicDominantFrame)

  const redditPosts = (posts || []).filter(p => p.platform === "reddit")
  const twitterPosts = (posts || []).filter(p => p.platform === "twitter")

  return (
    <div>
      {/* ── 1. GAP SCORE ── */}
      <div
        style={{
          padding: "20px",
          background: "var(--bg-tertiary)",
          display: "flex",
          alignItems: "baseline",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <span style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          GAP SCORE
        </span>
        <span style={{ ...display, fontSize: "36px", fontWeight: 700, color: directionColor, lineHeight: 1 }}>
          {gap.gapScore}
        </span>
        <span style={{ ...mono, fontSize: "14px", color: "var(--text-tertiary)" }}>/ 100</span>
        <span style={{ ...mono, fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: directionColor, marginLeft: "auto" }}>
          {toTitleCase(gap.gapDirection)}
        </span>
      </div>

      {/* ── 2. SIDE-BY-SIDE FRAMING COMPARISON ── */}
      <div style={{ display: "flex", gap: "24px", paddingBottom: "20px", borderBottom: "1px solid var(--border-primary)" }}>
        {/* Media side */}
        <div style={{ flex: 1 }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "8px" }}>
            MEDIA FRAMING
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ ...mono, fontSize: "12px", color: mediaColor, minWidth: "80px" }}>
              {toTitleCase(gap.mediaDominantFrame)}
            </span>
            <div style={{ flex: 1, height: "6px", background: "var(--border-primary)" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, gap.mediaFramePct))}%`, height: "100%", background: mediaColor }} />
            </div>
            <span style={{ ...mono, fontSize: "12px", color: "var(--text-tertiary)" }}>{gap.mediaFramePct}%</span>
          </div>
        </div>

        {/* Public side */}
        <div style={{ flex: 1 }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "8px" }}>
            PUBLIC DISCOURSE
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ ...mono, fontSize: "12px", color: publicColor, minWidth: "80px" }}>
              {toTitleCase(gap.publicDominantFrame)}
            </span>
            <div style={{ flex: 1, height: "6px", background: "var(--border-primary)" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, gap.publicFramePct))}%`, height: "100%", background: publicColor }} />
            </div>
            <span style={{ ...mono, fontSize: "12px", color: "var(--text-tertiary)" }}>{gap.publicFramePct}%</span>
          </div>
        </div>
      </div>

      {/* ── 3. GAP SUMMARY ── */}
      <p style={{ ...body, fontSize: "14px", fontStyle: "italic", lineHeight: 1.7, color: "var(--text-secondary)", marginTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border-primary)" }}>
        {typeof gap.gapSummary === 'string' ? gap.gapSummary : ''}
      </p>

      {/* ── Arrow legend ── */}
      {(surfacedFirst.length > 0 || mediaIgnored.length > 0) && (
        <div style={{ display: "flex", gap: "16px", marginTop: "12px", marginBottom: "4px" }}>
          <span style={{ ...mono, fontSize: "10px", color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--accent-green)", marginRight: "4px" }}>{"\u25B2"}</span> Social found first
          </span>
          <span style={{ ...mono, fontSize: "10px", color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--accent-red)", marginRight: "4px" }}>{"\u25BC"}</span> Media reported, social ignored
          </span>
        </div>
      )}

      {/* ── 4. WHAT SOCIAL FOUND FIRST ── */}
      {surfacedFirst.length > 0 && (
        <div style={{ marginTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border-primary)" }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "8px" }}>
            WHAT SOCIAL FOUND FIRST
          </p>
          {surfacedFirst.map((item, i) => {
            // Handle both old string format and new {insight, platform} format
            const isObj = typeof item === "object" && item !== null && "insight" in (item as Record<string, unknown>)
            const insight = isObj ? (item as { insight: string }).insight : String(item)
            const platform = isObj ? (item as { platform: string }).platform : null

            return (
              <p key={i} style={{ ...body, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6, paddingLeft: "16px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ ...mono, color: "var(--accent-green)", flexShrink: 0 }}>{"\u25B2"}</span>
                <span style={{ flex: 1 }}>{insight}</span>
                {platform && (
                  <span style={{ ...mono, fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: platform === "twitter" ? "var(--text-tertiary)" : "var(--accent-amber)", flexShrink: 0 }}>
                    {platform === "twitter" ? "X" : "Reddit"}
                  </span>
                )}
              </p>
            )
          })}
        </div>
      )}

      {/* ── 5. WHAT MEDIA REPORTED THAT SOCIAL IGNORED ── */}
      {mediaIgnored.length > 0 && (
        <div style={{ marginTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border-primary)" }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "8px" }}>
            WHAT MEDIA REPORTED THAT SOCIAL IGNORED
          </p>
          {mediaIgnored.map((item, i) => (
            <p key={i} style={{ ...body, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6, paddingLeft: "16px", marginBottom: "4px" }}>
              <span style={{ ...mono, color: "var(--accent-red)", marginRight: "8px" }}>{"\u25BC"}</span>
              {item}
            </p>
          ))}
        </div>
      )}

      {/* ── 6. TOP POSTS — REDDIT ── */}
      {redditPosts.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "12px" }}>
            TOP POSTS — REDDIT
          </p>
          {redditPosts.map((post, i) => (
            <PostCard key={`reddit-${i}`} post={post} />
          ))}
        </div>
      )}

      {/* ── 7. TOP POSTS — TWITTER/X ── */}
      {twitterPosts.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "12px" }}>
            TOP POSTS — TWITTER/X
          </p>
          {twitterPosts.map((post, i) => (
            <PostCard key={`twitter-${i}`} post={post} />
          ))}
        </div>
      )}

      {/* ── 8. THE COUNTER-NARRATIVE ── */}
      {gap.publicCounterNarrative && (
        <div style={{ marginTop: "20px", paddingLeft: "16px", borderLeft: "3px solid var(--accent-purple)", paddingBottom: "16px" }}>
          <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "8px" }}>
            THE COUNTER-NARRATIVE
          </p>
          <p style={{ ...body, fontSize: "14px", lineHeight: 1.7, color: "var(--text-secondary)", fontStyle: "italic" }}>
            {typeof gap.publicCounterNarrative === 'string' ? gap.publicCounterNarrative : JSON.stringify(gap.publicCounterNarrative)}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Post Card (handles both platforms) ── */

function PostCard({ post }: {
  post: {
    platform: string
    url?: string | null
    author?: string | null
    subreddit?: string | null
    content: string
    upvotes: number
    comments: number
    shares?: number | null
    views?: number | null
    framingType?: string | null
    sentiment?: string | null
  }
}) {
  const framingColor = post.framingType ? getFramingColor(post.framingType) : "var(--text-tertiary)"
  const isTwitter = post.platform === "twitter"

  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border-primary)" }}>
      {/* Post header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
        {/* Platform badge */}
        <span style={{
          ...mono,
          fontSize: "9px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "1px 5px",
          border: `1px solid ${isTwitter ? "var(--text-tertiary)" : "var(--accent-amber)"}`,
          color: isTwitter ? "var(--text-tertiary)" : "var(--accent-amber)",
        }}>
          {isTwitter ? "X" : "Reddit"}
        </span>

        {/* Source identifier */}
        {isTwitter ? (
          <span style={{ ...mono, fontSize: "12px", color: "var(--text-primary)" }}>
            @{post.author}
          </span>
        ) : post.subreddit ? (
          <span style={{ ...mono, fontSize: "12px", color: "var(--text-primary)" }}>
            r/{post.subreddit}
          </span>
        ) : null}

        {/* Engagement metrics */}
        {isTwitter ? (
          <>
            <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>
              {"\u25CF"} {formatNumber(post.upvotes)} likes
            </span>
            {(post.shares ?? 0) > 0 && (
              <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>
                {"\u25CF"} {formatNumber(post.shares!)} RTs
              </span>
            )}
          </>
        ) : (
          <>
            <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>
              {"\u25CF"} {formatNumber(post.upvotes)} upvotes
            </span>
            {post.comments > 0 && (
              <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>
                {"\u25CF"} {formatNumber(post.comments)} comments
              </span>
            )}
          </>
        )}

        {/* Framing type tag */}
        {post.framingType && (
          <span style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: framingColor, marginLeft: "auto" }}>
            {"\u25A0"} {toTitleCase(post.framingType)}
          </span>
        )}
      </div>

      {/* Post content snippet */}
      <p style={{
        ...body,
        fontSize: "13px",
        color: "var(--text-secondary)",
        lineHeight: 1.5,
        overflow: "hidden",
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
      }}>
        {post.content.substring(0, 200)}
      </p>

      {/* Sentiment + link row */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
        {post.sentiment && (
          <span style={{ ...mono, fontSize: "10px", color: "var(--text-tertiary)" }}>
            sentiment: {post.sentiment}
          </span>
        )}
        {post.url && (
          <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginLeft: "auto" }}>
            source &rarr;
          </a>
        )}
      </div>
    </div>
  )
}
