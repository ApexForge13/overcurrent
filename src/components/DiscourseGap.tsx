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
    subreddit?: string | null
    content: string
    upvotes: number
    comments: number
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
}

function getFramingColor(frame: string): string {
  const key = frame.toLowerCase().replace(/[\s-]/g, "_")
  return FRAMING_COLORS[key] || "var(--text-tertiary)"
}

function getDirectionColor(direction: string): string {
  const d = direction.toLowerCase()
  if (d === "aligned") return "var(--accent-green)"
  if (d === "opposed") return "var(--accent-red)"
  return "var(--accent-amber)"
}

function parseJsonArray(value: string | string[] | null | undefined): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatNumber(n: number): string {
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
  const mediaIgnored = parseJsonArray(gap.mediaIgnoredByPublic)
  const directionColor = getDirectionColor(gap.gapDirection)
  const mediaColor = getFramingColor(gap.mediaDominantFrame)
  const publicColor = getFramingColor(gap.publicDominantFrame)

  return (
    <div>
      {/* ── 1. SIDE-BY-SIDE FRAMING BARS ── */}
      <div
        style={{
          display: "flex",
          gap: "24px",
          paddingBottom: "20px",
          borderBottom: "1px solid var(--border-primary)",
        }}
      >
        {/* Media side */}
        <div style={{ flex: 1 }}>
          <p
            style={{
              ...mono,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: "8px",
            }}
          >
            MEDIA FRAMING
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                ...mono,
                fontSize: "12px",
                color: mediaColor,
                textTransform: "capitalize",
                minWidth: "70px",
              }}
            >
              {gap.mediaDominantFrame}
            </span>
            <div
              style={{
                flex: 1,
                height: "6px",
                background: "var(--border-primary)",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, gap.mediaFramePct))}%`,
                  height: "100%",
                  background: mediaColor,
                }}
              />
            </div>
            <span style={{ ...mono, fontSize: "12px", color: "var(--text-tertiary)" }}>
              {gap.mediaFramePct}%
            </span>
          </div>
        </div>

        {/* Public side */}
        <div style={{ flex: 1 }}>
          <p
            style={{
              ...mono,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: "8px",
            }}
          >
            PUBLIC DISCOURSE
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                ...mono,
                fontSize: "12px",
                color: publicColor,
                textTransform: "capitalize",
                minWidth: "70px",
              }}
            >
              {gap.publicDominantFrame}
            </span>
            <div
              style={{
                flex: 1,
                height: "6px",
                background: "var(--border-primary)",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, gap.publicFramePct))}%`,
                  height: "100%",
                  background: publicColor,
                }}
              />
            </div>
            <span style={{ ...mono, fontSize: "12px", color: "var(--text-tertiary)" }}>
              {gap.publicFramePct}%
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. GAP SCORE ── */}
      <div
        style={{
          marginTop: "20px",
          padding: "16px",
          background: "var(--bg-tertiary)",
          display: "flex",
          alignItems: "baseline",
          gap: "16px",
        }}
      >
        <span
          style={{
            ...mono,
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          GAP SCORE
        </span>
        <span
          style={{
            ...display,
            fontSize: "36px",
            fontWeight: 700,
            color: directionColor,
            lineHeight: 1,
          }}
        >
          {gap.gapScore}
        </span>
        <span
          style={{
            ...mono,
            fontSize: "14px",
            color: "var(--text-tertiary)",
          }}
        >
          / 100
        </span>
        <span
          style={{
            ...mono,
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: directionColor,
            marginLeft: "auto",
          }}
        >
          {gap.gapDirection.replace(/_/g, " ")}
        </span>
      </div>

      {/* ── 3. GAP SUMMARY ── */}
      <p
        style={{
          ...body,
          fontSize: "14px",
          fontStyle: "italic",
          lineHeight: 1.7,
          color: "var(--text-secondary, #a3a3a3)",
          marginTop: "16px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border-primary)",
        }}
      >
        {gap.gapSummary}
      </p>

      {/* ── 4. WHAT SOCIAL FOUND FIRST ── */}
      {surfacedFirst.length > 0 && (
        <div style={{ marginTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border-primary)" }}>
          <p
            style={{
              ...mono,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: "8px",
            }}
          >
            WHAT SOCIAL FOUND FIRST
          </p>
          {surfacedFirst.map((item, i) => (
            <p
              key={i}
              style={{
                ...body,
                fontSize: "13px",
                color: "var(--text-secondary, #a3a3a3)",
                lineHeight: 1.6,
                paddingLeft: "16px",
                marginBottom: "4px",
              }}
            >
              <span style={{ ...mono, color: "var(--accent-green)", marginRight: "8px" }}>
                {"\u25B2"}
              </span>
              {item}
            </p>
          ))}
        </div>
      )}

      {/* ── 5. WHAT MEDIA REPORTED THAT SOCIAL IGNORED ── */}
      {mediaIgnored.length > 0 && (
        <div style={{ marginTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border-primary)" }}>
          <p
            style={{
              ...mono,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: "8px",
            }}
          >
            WHAT MEDIA REPORTED THAT SOCIAL IGNORED
          </p>
          {mediaIgnored.map((item, i) => (
            <p
              key={i}
              style={{
                ...body,
                fontSize: "13px",
                color: "var(--text-secondary, #a3a3a3)",
                lineHeight: 1.6,
                paddingLeft: "16px",
                marginBottom: "4px",
              }}
            >
              <span style={{ ...mono, color: "var(--accent-red)", marginRight: "8px" }}>
                {"\u25BC"}
              </span>
              {item}
            </p>
          ))}
        </div>
      )}

      {/* ── 6. THE COUNTER-NARRATIVE ── */}
      {gap.publicCounterNarrative && (
        <div
          style={{
            marginTop: "16px",
            paddingLeft: "16px",
            borderLeft: "3px solid var(--accent-purple)",
            paddingBottom: "16px",
          }}
        >
          <p
            style={{
              ...mono,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: "8px",
            }}
          >
            THE COUNTER-NARRATIVE
          </p>
          <p
            style={{
              ...body,
              fontSize: "14px",
              lineHeight: 1.7,
              color: "var(--text-secondary, #a3a3a3)",
              fontStyle: "italic",
            }}
          >
            {gap.publicCounterNarrative}
          </p>
        </div>
      )}

      {/* ── 7. TOP POSTS ── */}
      {posts && posts.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <p
            style={{
              ...mono,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              marginBottom: "12px",
            }}
          >
            TOP POSTS
          </p>
          {posts.map((post, i) => {
            const framingColor = post.framingType
              ? getFramingColor(post.framingType)
              : "var(--text-tertiary)"

            return (
              <div
                key={i}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-primary)",
                }}
              >
                {/* Post header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "6px",
                    flexWrap: "wrap",
                  }}
                >
                  {post.subreddit && (
                    <span style={{ ...mono, fontSize: "12px", color: "var(--text-primary)" }}>
                      r/{post.subreddit}
                    </span>
                  )}
                  <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>
                    {"\u25CF"} {formatNumber(post.upvotes)} upvotes
                  </span>
                  {post.comments > 0 && (
                    <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {"\u25CF"} {formatNumber(post.comments)} comments
                    </span>
                  )}
                  {post.framingType && (
                    <span
                      style={{
                        ...mono,
                        fontSize: "10px",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: framingColor,
                        marginLeft: "auto",
                      }}
                    >
                      {"\u25A0"} {post.framingType.replace(/_/g, " ")}
                    </span>
                  )}
                </div>

                {/* Post content snippet */}
                <p
                  style={{
                    ...body,
                    fontSize: "13px",
                    color: "var(--text-secondary, #a3a3a3)",
                    lineHeight: 1.5,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {post.content}
                </p>

                {/* Sentiment tag */}
                {post.sentiment && (
                  <span
                    style={{
                      ...mono,
                      fontSize: "10px",
                      color: "var(--text-tertiary)",
                      marginTop: "4px",
                      display: "inline-block",
                    }}
                  >
                    sentiment: {post.sentiment}
                  </span>
                )}

                {/* Link */}
                {post.url && (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      ...mono,
                      fontSize: "11px",
                      color: "var(--text-tertiary)",
                      display: "block",
                      marginTop: "4px",
                    }}
                  >
                    source &rarr;
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
