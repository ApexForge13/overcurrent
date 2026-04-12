import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0B',
          borderRadius: '4px',
        }}
      >
        <span style={{
          fontSize: '18px',
          fontWeight: 900,
          color: '#E8E6E3',
          letterSpacing: '-1px',
        }}>
          OC
        </span>
      </div>
    ),
    { ...size },
  )
}
