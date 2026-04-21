import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

/**
 * GET /api/admin/review/list
 *
 * Returns the admin review queue: stories with status='review' plus their
 * latest QualityReviewCard (if any). Sorted by card recommendation priority
 * (hold/approved_with_edits above approved above stories-without-cards),
 * then by createdAt descending.
 *
 * Killed stories are EXCLUDED — they auto-archive before reaching this
 * endpoint. Use /api/admin/review/killed for the threshold-tuning surface.
 */
export async function GET() {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const stories = await prisma.story.findMany({
    where: { status: 'review' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      headline: true,
      synopsis: true,
      thePattern: true,
      confidenceLevel: true,
      sourceCount: true,
      countryCount: true,
      signalCategory: true,
      primaryCategory: true,
      analysisType: true,
      createdAt: true,
      qualityReviewCards: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          overallRecommendation: true,
          patternVerified: true,
          patternStressTestDetail: true,
          verificationSummary: true,
          editorialScores: true,
          sensitivityFlags: true,
          suggestedEdits: true,
          reviewCost: true,
          reviewDurationSeconds: true,
          webSearchesRun: true,
          createdAt: true,
        },
      },
    },
  })

  // Priority order for UI sort: hold → approved_with_edits → (no card yet) → approved
  const priority = (rec: string | null): number => {
    if (rec === 'hold') return 0
    if (rec === 'approved_with_edits') return 1
    if (rec === null) return 2
    if (rec === 'approved') return 3
    return 4
  }

  const rows = stories.map((s) => {
    const card = s.qualityReviewCards[0] ?? null
    return {
      id: s.id,
      slug: s.slug,
      headline: s.headline,
      synopsis: s.synopsis,
      thePattern: s.thePattern,
      confidenceLevel: s.confidenceLevel,
      sourceCount: s.sourceCount,
      countryCount: s.countryCount,
      signalCategory: s.signalCategory,
      primaryCategory: s.primaryCategory,
      analysisType: s.analysisType,
      createdAt: s.createdAt,
      qualityReviewCard: card,
    }
  })

  rows.sort((a, b) => {
    const pa = priority(a.qualityReviewCard?.overallRecommendation ?? null)
    const pb = priority(b.qualityReviewCard?.overallRecommendation ?? null)
    if (pa !== pb) return pa - pb
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return Response.json({ stories: rows })
}
