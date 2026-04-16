"use client"

interface BriefingDiscourseProps {
  gapScore: number
  mediaFraming: string
  publicFraming: string
  socialFoundFirst: Array<{
    finding: string
    platform: string
    engagement: string
  }>
  mediaIgnored: string[]
  redditCount: number
  twitterCount: number
}

export function BriefingDiscourse({
  gapScore, mediaFraming, publicFraming,
  socialFoundFirst, mediaIgnored,
  redditCount, twitterCount,
}: BriefingDiscourseProps) {
  if (!gapScore && !mediaFraming && socialFoundFirst.length === 0) return null

  const gapLabel = gapScore >= 60 ? 'Divergent' : gapScore >= 30 ? 'Misaligned' : 'Aligned'

  return (
    <div style={{ marginTop: "48px" }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}>
          WHAT THE PUBLIC FOUND
        </span>
        <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
      </div>

      {/* Gap score */}
      {gapScore > 0 && (
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          color: gapScore >= 60 ? "var(--accent-red)" : gapScore >= 30 ? "var(--accent-amber)" : "var(--accent-teal)",
          marginBottom: "20px",
        }}>
          GAP SCORE: {gapScore}/100 — Media and public are telling {gapLabel.toLowerCase()} stories
        </div>
      )}

      {/* Media vs Public side-by-side */}
      {(mediaFraming || publicFraming) && (
        <div style={{ display: "flex", gap: "24px", marginBottom: "24px" }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              color: "var(--text-tertiary)", marginBottom: "8px",
            }}>MEDIA SAYS</div>
            <p style={{
              fontFamily: "var(--font-body)", fontSize: "14px",
              color: "var(--text-secondary)", lineHeight: 1.5,
            }}>{mediaFraming}</p>
          </div>
          <div style={{ width: "1px", background: "var(--border-primary)" }} />
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              color: "var(--text-tertiary)", marginBottom: "8px",
            }}>PUBLIC SAYS</div>
            <p style={{
              fontFamily: "var(--font-body)", fontSize: "14px",
              color: "var(--text-secondary)", lineHeight: 1.5,
            }}>{publicFraming}</p>
          </div>
        </div>
      )}

      {/* Social Found First */}
      {socialFoundFirst.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: "var(--accent-teal)", marginBottom: "10px",
          }}>SOCIAL FOUND FIRST</div>
          {socialFoundFirst.slice(0, 3).map((item, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "6px 0", borderBottom: i < Math.min(socialFoundFirst.length, 3) - 1 ? "1px solid var(--border-primary)" : "none",
            }}>
              <span style={{
                fontFamily: "var(--font-body)", fontSize: "14px",
                color: "var(--text-primary)", flex: 1, lineHeight: 1.4,
              }}>{item.finding}</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "11px",
                color: "var(--text-tertiary)", marginLeft: "16px", flexShrink: 0, whiteSpace: "nowrap",
              }}>{item.platform}, {item.engagement}</span>
            </div>
          ))}
        </div>
      )}

      {/* Media Reported, Public Ignored */}
      {mediaIgnored.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase",
            color: "var(--text-tertiary)", marginBottom: "10px",
          }}>MEDIA REPORTED, PUBLIC IGNORED</div>
          {mediaIgnored.slice(0, 3).map((item, i) => (
            <p key={i} style={{
              fontFamily: "var(--font-body)", fontSize: "13px",
              color: "var(--text-secondary)", lineHeight: 1.4, marginBottom: "4px",
            }}>• {item}</p>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: "11px",
        color: "var(--text-tertiary)", marginTop: "16px",
      }}>
        {redditCount > 0 && <span>{redditCount} Reddit posts</span>}
        {redditCount > 0 && twitterCount > 0 && <span> · </span>}
        {twitterCount > 0 && <span>{twitterCount} Twitter/X posts analyzed</span>}
      </div>
    </div>
  )
}
