import { prisma } from '@/lib/db'
import { redirect, notFound } from 'next/navigation'
import { ReviewActions } from './ReviewActions'
import { featureFlags } from '@/lib/feature-flags'

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) notFound()
  const { id } = await params

  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      claims: { orderBy: { sortOrder: 'asc' } },
      sources: true,
      discrepancies: true,
      omissions: true,
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  })

  if (!story) redirect('/admin')

  const latestVersion = story.versions[0]
  const currentVersion = story.currentVersion

  // Group claims by version and status
  const v1Claims = story.claims.filter(c => c.addedInVersion === 1)
  const newClaims = story.claims.filter(c => c.addedInVersion > 1)
  const contradictedClaims = story.claims.filter(c => c.status === 'contradicted')
  const corroboratedClaims = story.claims.filter(c => c.status === 'corroborated')

  const newSources = story.sources.filter(s => s.addedInVersion > 1)
  const newDiscrepancies = story.discrepancies.filter(d => d.addedInVersion > 1)

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px', background: '#0A0A0B', color: '#E8E6E3', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <a href="/admin" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#5C5A56' }}>&larr; Back to admin</a>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, margin: '16px 0 8px' }}>
          Review: {story.headline}
        </h1>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#5C5A56' }}>
          Version {currentVersion} &rarr; {currentVersion + 1} &middot; {latestVersion?.status ?? 'pending'}
        </div>
      </div>

      {/* Changes Summary */}
      {latestVersion?.changesSummary && (
        <div style={{ padding: '16px', border: '1px solid #2A9D8F', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#2A9D8F', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            WHAT CHANGED
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: '#E8E6E3', lineHeight: 1.6 }}>
            {latestVersion.changesSummary}
          </p>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#5C5A56', marginTop: '8px' }}>
            {latestVersion.newClaimsAdded} new claims &middot; {latestVersion.claimsContradicted} contradicted &middot; {latestVersion.claimsCorroborated} corroborated &middot; {latestVersion.newSourceCount} new sources &middot; ${latestVersion.costUsd.toFixed(2)} cost
          </div>
        </div>
      )}

      {/* Action buttons */}
      <ReviewActions storyId={id} versionId={latestVersion?.id ?? ''} />

      {/* New Claims */}
      {newClaims.length > 0 && (
        <section style={{ marginTop: '32px' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#2A9D8F', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
            NEW CLAIMS ({newClaims.length})
          </h2>
          {newClaims.map(claim => (
            <div key={claim.id} style={{ padding: '12px 16px', borderLeft: '3px solid #2A9D8F', marginBottom: '12px', background: '#111' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#2A9D8F', marginRight: '8px' }}>NEW v{claim.addedInVersion}</span>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: '#E8E6E3', marginTop: '4px' }}>{claim.claim}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#5C5A56', marginTop: '4px' }}>{claim.confidence} &middot; Supported by: {claim.supportedBy}</p>
            </div>
          ))}
        </section>
      )}

      {/* Contradicted Claims */}
      {contradictedClaims.length > 0 && (
        <section style={{ marginTop: '32px' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#F4A261', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
            CONTRADICTED CLAIMS ({contradictedClaims.length})
          </h2>
          {contradictedClaims.map(claim => (
            <div key={claim.id} style={{ padding: '12px 16px', borderLeft: '3px solid #F4A261', marginBottom: '12px', background: '#111' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#F4A261', marginRight: '8px' }}>CONTRADICTED in v{claim.contradictedInVersion}</span>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: '#E8E6E3', marginTop: '4px', textDecoration: 'line-through', opacity: 0.7 }}>{claim.claim}</p>
              {claim.contradictionNote && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: '#F4A261', marginTop: '8px' }}>
                  Contradiction: {claim.contradictionNote}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Corroborated Claims */}
      {corroboratedClaims.length > 0 && (
        <section style={{ marginTop: '32px' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#00F5A0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
            CORROBORATED CLAIMS ({corroboratedClaims.length})
          </h2>
          {corroboratedClaims.map(claim => (
            <div key={claim.id} style={{ padding: '12px 16px', borderLeft: '3px solid #00F5A0', marginBottom: '12px', background: '#111' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#00F5A0', marginRight: '8px' }}>CORROBORATED</span>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: '#E8E6E3', marginTop: '4px' }}>{claim.claim}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#5C5A56', marginTop: '4px' }}>{claim.notes}</p>
            </div>
          ))}
        </section>
      )}

      {/* New Sources */}
      {newSources.length > 0 && (
        <section style={{ marginTop: '32px' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#378ADD', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
            NEW SOURCES ({newSources.length})
          </h2>
          <div style={{ display: 'grid', gap: '4px' }}>
            {newSources.map(source => (
              <div key={source.id} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#a3a3a3', padding: '4px 0' }}>
                <span style={{ color: '#378ADD' }}>+</span> {source.outlet} &middot; {source.country} &middot; {source.region}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* New Discrepancies */}
      {newDiscrepancies.length > 0 && (
        <section style={{ marginTop: '32px' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#E24B4A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
            NEW DISCREPANCIES ({newDiscrepancies.length})
          </h2>
          {newDiscrepancies.map(disc => (
            <div key={disc.id} style={{ padding: '12px 16px', borderLeft: '3px solid #E24B4A', marginBottom: '12px', background: '#111' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: '#E8E6E3' }}>{disc.issue}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#5C5A56', marginTop: '4px' }}>
                Side A ({disc.sourcesA}): {disc.sideA}
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#5C5A56', marginTop: '2px' }}>
                Side B ({disc.sourcesB}): {disc.sideB}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* All V1 Claims (reference) */}
      <section style={{ marginTop: '48px', borderTop: '1px solid #1e1e1e', paddingTop: '24px' }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#5C5A56', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '16px' }}>
          ORIGINAL V1 CLAIMS ({v1Claims.length}) -- Reference
        </h2>
        {v1Claims.map(claim => (
          <div key={claim.id} style={{ padding: '8px 0', borderBottom: '1px solid #1a1a1a' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: '#a3a3a3' }}>{claim.claim}</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#5C5A56', marginTop: '2px' }}>{claim.confidence} &middot; {claim.status}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
