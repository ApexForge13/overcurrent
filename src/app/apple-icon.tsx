import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '180px',
          height: '180px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0B',
          borderRadius: '24px',
        }}
      >
        <span style={{
          fontSize: '72px',
          fontWeight: 900,
          color: '#E8E6E3',
          letterSpacing: '-3px',
        }}>
          OC
        </span>
      </div>
    ),
    { ...size },
  )
}
