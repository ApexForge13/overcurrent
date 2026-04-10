import { prisma } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
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
