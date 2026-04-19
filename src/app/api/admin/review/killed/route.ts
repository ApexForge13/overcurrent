import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'

/**
 * GET /api/admin/review/killed
 *
 * Returns stories auto-killed by the quality review agent — status='archived'
 * AND latest QualityReviewCard.overallRecommendation='kill'. Powers
 * /admin/review/killed for threshold tuning: if the agent kills stories the
 * admin would have published, adjust the system prompt.
 *
 * Revive via PUT /api/admin/stories/[id] { status: 'review' }.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  // Load archived stories that have at least one kill card, attach the latest.
  // Filter in JS rather than SQL to keep the query simple; admin surface is low volume.
  const stories = await prisma.story.findMany({
    where: {
      status: 'archived',
      qualityReviewCards: { some: { overallRecommendation: 'kill' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      slug: true,
      headline: true,
      synopsis: true,
      thePattern: true,
      sourceCount: true,
      signalCategory: true,
      primaryCategory: true,
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

  const rows = stories
    .filter((s) => s.qualityReviewCards[0]?.overallRecommendation === 'kill')
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      headline: s.headline,
      synopsis: s.synopsis,
      thePattern: s.thePattern,
      sourceCount: s.sourceCount,
      signalCategory: s.signalCategory,
      primaryCategory: s.primaryCategory,
      createdAt: s.createdAt,
      qualityReviewCard: s.qualityReviewCards[0],
    }))

  return Response.json({ stories: rows })
}
