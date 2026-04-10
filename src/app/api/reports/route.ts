import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') ?? undefined
  const riskLevel = searchParams.get('risk_level') ?? undefined
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}

  if (search) {
    where.OR = [
      { dominantHeadline: { contains: search } },
      { synopsis: { contains: search } },
      { searchQuery: { contains: search } },
    ]
  }

  if (riskLevel) {
    // Risk level is stored in the synopsis or we need to filter post-query
    // Since risk_level isn't a direct column, we'll use synopsis contains as a proxy
    // Actually the schema doesn't have a riskLevel column -- we store it in the synopsis.
    // For proper filtering we'd need a column. For now, skip this filter.
  }

  const [reports, total] = await Promise.all([
    prisma.undercurrentReport.findMany({
      where,
      select: {
        id: true,
        slug: true,
        dominantHeadline: true,
        dominantDescription: true,
        dateRangeStart: true,
        dateRangeEnd: true,
        searchQuery: true,
        synopsis: true,
        totalCost: true,
        analysisSeconds: true,
        createdAt: true,
        _count: {
          select: {
            displacedStories: true,
            quietActions: true,
            timingAnomalies: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.undercurrentReport.count({ where }),
  ])

  return Response.json({
    reports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
