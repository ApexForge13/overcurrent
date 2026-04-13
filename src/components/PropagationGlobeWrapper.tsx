'use client'

import dynamic from 'next/dynamic'

const PropagationGlobe = dynamic(
  () => import('./PropagationGlobe').then((mod) => ({ default: mod.PropagationGlobe })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          width: '100%',
          aspectRatio: '16/10',
          maxHeight: '750px',
          background: '#0A0A0B',
          border: '1px solid #1e1e1e',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: '12px',
            color: '#5C5A56',
          }}
        >
          Loading globe...
        </span>
      </div>
    ),
  }
)

export { PropagationGlobe as PropagationGlobeClient }

export type { PropagationGlobeProps } from './PropagationGlobe'
