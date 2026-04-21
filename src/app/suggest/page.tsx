import { notFound } from 'next/navigation'
import { SuggestForm } from './SuggestForm'
import { featureFlags } from '@/lib/feature-flags'

export default function SuggestPage() {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) notFound()
  return (
    <div
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '64px 24px 96px',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 36,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 12,
          letterSpacing: '-0.02em',
        }}
      >
        Suggest a Story
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
          marginBottom: 48,
        }}
      >
        Suggestions are reviewed by our editorial team. We choose which stories
        to analyze.
      </p>

      <SuggestForm />
    </div>
  )
}
