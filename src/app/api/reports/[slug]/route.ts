import { prisma } from '@/lib/db'
import { featureFlags } from '@/lib/feature-flags'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const { slug } = await params

  const report = await prisma.undercurrentReport.findUnique({
    where: { slug },
    include: {
      displacedStories: { orderBy: { sortOrder: 'asc' } },
      quietActions: { orderBy: { sortOrder: 'asc' } },
      timingAnomalies: { orderBy: { sortOrder: 'asc' } },
    },
  })

  if (!report) {
    return Response.json({ error: 'Report not found' }, { status: 404 })
  }

  return Response.json(report)
}
