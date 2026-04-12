"use client";

interface SocialPreviewProps {
  platform: string;
  content: string;
  headline?: string;
  confidenceLevel?: string;
  consensusScore?: number;
}

const PLATFORM_STYLES: Record<string, { bg: string; maxChars: number | null; label: string }> = {
  twitter_hook: { bg: '#000000', maxChars: 280, label: 'X / Twitter' },
  twitter_thread: { bg: '#000000', maxChars: null, label: 'X Thread' },
  reddit: { bg: '#1A1A1B', maxChars: null, label: 'Reddit' },
  linkedin: { bg: '#1B1F23', maxChars: 3000, label: 'LinkedIn' },
  tiktok: { bg: '#121212', maxChars: null, label: 'TikTok Script' },
  newsletter: { bg: '#1A1A1E', maxChars: null, label: 'Newsletter' },
}

export function SocialPreview({ platform, content, headline, confidenceLevel, consensusScore }: SocialPreviewProps) {
  const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.twitter_hook
  const displayContent = content.replace(/\[LINK\]/g, 'overcurrent.news/story/...')
  const charCount = content.length
  const overLimit = style.maxChars ? charCount > style.maxChars : false

  return (
    <div style={{
      background: style.bg,
      border: '1px solid var(--border-primary)',
      padding: '16px',
      maxWidth: '520px',
    }}>
      {/* Platform header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {style.label}
          </span>
        </div>
        {style.maxChars && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: overLimit ? 'var(--accent-red)' : 'var(--text-tertiary)',
          }}>
            {charCount}/{style.maxChars}
          </span>
        )}
      </div>

      {/* Overcurrent branding bar */}
      <div className="flex items-center gap-2 mb-3" style={{
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        paddingBottom: '8px',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: '#E8E6E3',
        }}>
          OVERCURRENT
        </span>
        {confidenceLevel && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: confidenceLevel === 'HIGH' ? '#2A9D8F' : confidenceLevel === 'LOW' ? '#E63946' : '#F4A261',
            letterSpacing: '0.04em',
          }}>
            {confidenceLevel}
          </span>
        )}
        {consensusScore !== undefined && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--text-tertiary)',
          }}>
            {consensusScore}% consensus
          </span>
        )}
      </div>

      {/* Post content */}
      {platform === 'twitter_thread' ? (
        <div className="space-y-3">
          {displayContent.split('---').map((tweet, i) => (
            <div key={i} style={{
              padding: '8px 0',
              borderBottom: i < displayContent.split('---').length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--text-tertiary)',
                marginBottom: '4px',
                display: 'block',
              }}>
                {i + 1}/{displayContent.split('---').length}
              </span>
              <p style={{
                fontFamily: 'var(--font-body)',
                fontSize: '13px',
                color: '#E8E6E3',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}>
                {tweet.trim()}
              </p>
            </div>
          ))}
        </div>
      ) : platform === 'reddit' ? (
        <div>
          {headline && (
            <h3 style={{
              fontFamily: 'var(--font-body)',
              fontSize: '15px',
              fontWeight: 600,
              color: '#E8E6E3',
              marginBottom: '8px',
            }}>
              {headline}
            </h3>
          )}
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            color: '#D7DADC',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {displayContent}
          </p>
        </div>
      ) : (
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: platform === 'tiktok' ? '14px' : '13px',
          color: '#E8E6E3',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontStyle: platform === 'tiktok' ? 'italic' : 'normal',
        }}>
          {displayContent}
        </p>
      )}

      {/* Footer with link preview */}
      {content.includes('[LINK]') && (
        <div className="mt-3" style={{
          padding: '8px 12px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.03)',
        }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
            overcurrent.news
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '12px', color: '#E8E6E3', fontWeight: 500, marginTop: '2px' }}>
            {headline || 'Overcurrent Analysis'}
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            Every outlet shows you their version. We show you everyone&apos;s.
          </p>
        </div>
      )}
    </div>
  )
}
