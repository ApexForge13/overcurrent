import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { prisma } from '@/lib/db'
import { recomputeUmbrellaProfiles } from '@/lib/umbrella-outlet-profile'

/**
 * GET /api/admin/umbrellas/[id]/outlet-profiles
 *
 * Returns cross-event outlet fingerprints for this umbrella.
 *
 * Section 4 of the umbrella detail page gates the rendering of this data:
 *   - umbrella.totalAnalyses < 3 → section shows "Cross-event patterns require
 *                                    3 analyses — currently at X of 3" banner
 *   - umbrella.totalAnalyses >= 3 → fingerprints render; outlets with
 *                                    analysesAppeared < 5 get "Insufficient
 *                                    Data" badge.
 *
 * POST to the same path to force recompute. Otherwise returns the latest
 * stored rows from OutletUmbrellaProfile.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  const [umbrella, profiles] = await Promise.all([
    prisma.umbrellaArc.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        totalAnalyses: true,
        signalCategory: true,
      },
    }),
    prisma.outletUmbrellaProfile.findMany({
      where: { umbrellaArcId: id },
      orderBy: [
        { analysesAppeared: 'desc' },
        { frameConsistency: 'desc' },
      ],
    }),
  ])

  if (!umbrella) return Response.json({ error: 'Umbrella not found' }, { status: 404 })

  // Join with Outlet data for display
  const outletIds = profiles.map(p => p.outletId)
  const outlets = outletIds.length > 0
    ? await prisma.outlet.findMany({
        where: { id: { in: outletIds } },
        select: { id: true, domain: true, name: true, tier: true, politicalLean: true, reliability: true },
      })
    : []
  const outletById = new Map(outlets.map(o => [o.id, o]))

  return Response.json({
    umbrella: {
      id: umbrella.id,
      name: umbrella.name,
      totalAnalyses: umbrella.totalAnalyses,
      signalCategory: umbrella.signalCategory,
    },
    // UI gates rendering on this threshold (per spec)
    thresholdMet: umbrella.totalAnalyses >= 3,
    profiles: profiles.map(p => {
      const outlet = outletById.get(p.outletId)
      return {
        outletId: p.outletId,
        outletName: outlet?.name ?? '(unknown)',
        outletDomain: outlet?.domain ?? '',
        tier: outlet?.tier ?? 'unclassified',
        politicalLean: outlet?.politicalLean ?? 'unknown',
        reliability: outlet?.reliability ?? 'unknown',
        analysesAppeared: p.analysesAppeared,
        frameConsistency: p.frameConsistency,
        earlyMoverRate: p.earlyMoverRate,
        omissionConsistencyRate: p.omissionConsistencyRate,
        insufficientData: p.analysesAppeared < 5,
        computedAt: p.computedAt.toISOString(),
      }
    }),
  })
}

/**
 * POST /api/admin/umbrellas/[id]/outlet-profiles
 *
 * Force recompute. Useful for backfill / testing / after schema changes.
 * Production path runs recompute automatically from pipeline.ts after each
 * new analysis is filed under the umbrella.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  try {
    const results = await recomputeUmbrellaProfiles(id)
    return Response.json({
      computedCount: results.length,
      outletsProcessed: results.map(r => r.outletDomain),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Recompute failed'
    return Response.json({ error: msg }, { status: 500 })
  }
}
