import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const headline = searchParams.get('headline') || 'Coverage Analysis'
  const confidence = searchParams.get('confidence') || 'DEVELOPING'
  const sources = searchParams.get('sources') || '0'
  const countries = searchParams.get('countries') || '0'

  const confidenceColor = confidence === 'HIGH' ? '#2A9D8F' :
    confidence === 'MEDIUM' ? '#F4A261' :
    confidence === 'LOW' ? '#E63946' : '#5C5A56'

  return new ImageResponse(
    (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0A0A0B',
        padding: '48px 56px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '0.06em', color: '#E8E6E3' }}>
            OVERCURRENT
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', color: confidenceColor, textTransform: 'uppercase' }}>
              {confidence}
            </div>
          </div>
        </div>

        {/* Headline */}
        <div style={{
          fontSize: headline.length > 80 ? '36px' : '44px',
          fontWeight: 700,
          lineHeight: 1.15,
          color: '#E8E6E3',
          maxWidth: '900px',
          letterSpacing: '-0.02em',
        }}>
          {headline.length > 120 ? headline.substring(0, 117) + '...' : headline}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '24px', fontSize: '14px', color: '#9A9894' }}>
            <span>{sources} sources</span>
            <span>{countries} countries</span>
            <span>4 AI models</span>
          </div>
          <div style={{ fontSize: '12px', color: '#5C5A56' }}>
            overcurrent.news
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  )
}
