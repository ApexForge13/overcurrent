import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { prisma } from '@/lib/db'

/**
 * GET /api/admin/predictive-signals
 *
 * Lists recent PredictiveSignal records with their cluster + arc quality
 * metadata. Feeds the /admin/signals/predictive page and its data-quality
 * banners (Session 3 Step 6).
 *
 * Query params:
 *   limit — max rows (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)))

  const signals = await prisma.predictiveSignal.findMany({
    take: limit,
    orderBy: { generatedAt: 'desc' },
    select: {
      id: true,
      predictedDominantFraming: true,
      framingConfidencePct: true,
      topOmissionRisks: true,
      momentumFlag: true,
      momentumReason: true,
      computedFromAnalysesCount: true,
      contributingArcsBreakdown: true,
      generatedAt: true,
      storyClusterId: true,
      storyCluster: {
        select: {
          id: true,
          clusterHeadline: true,
          signalCategory: true,
          canonicalSignalCategory: true,
          arcCompleteness: true,
        },
      },
      story: {
        select: { id: true, slug: true, headline: true },
      },
    },
  })

  return Response.json({
    signals: signals.map(s => {
      let breakdown: Record<string, unknown> = {}
      try {
        if (s.contributingArcsBreakdown) breakdown = JSON.parse(s.contributingArcsBreakdown)
      } catch {
        breakdown = {}
      }
      return {
        id: s.id,
        predictedDominantFraming: s.predictedDominantFraming,
        framingConfidencePct: s.framingConfidencePct,
        momentumFlag: s.momentumFlag,
        momentumReason: s.momentumReason,
        computedFromAnalysesCount: s.computedFromAnalysesCount,
        generatedAt: s.generatedAt.toISOString(),
        cluster: {
          id: s.storyCluster.id,
          headline: s.storyCluster.clusterHeadline,
          signalCategory: s.storyCluster.canonicalSignalCategory ?? s.storyCluster.signalCategory,
          arcCompleteness: s.storyCluster.arcCompleteness,
        },
        story: s.story ? { id: s.story.id, slug: s.story.slug, headline: s.story.headline } : null,
        breakdown: {
          complete: Number(breakdown.complete ?? 0),
          partial: Number(breakdown.partial ?? 0),
          first_wave_only: Number(breakdown.first_wave_only ?? 0),
          incomplete: Number(breakdown.incomplete ?? 0),
          unclassified: Number(breakdown.unclassified ?? 0),
          skippedPhases: Number(breakdown.skippedPhases ?? 0),
          umbrellas: Array.isArray(breakdown.umbrellas) ? breakdown.umbrellas : [],
        },
      }
    }),
  })
}
