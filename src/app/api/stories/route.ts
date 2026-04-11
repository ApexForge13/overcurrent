import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') ?? undefined
  const category = searchParams.get('category') ?? undefined
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = { status: 'published' }

  if (search) {
    where.OR = [
      { headline: { contains: search } },
      { synopsis: { contains: search } },
      { searchQuery: { contains: search } },
    ]
  }

  if (category) {
    where.category = category
  }

  const [stories, total] = await Promise.all([
    prisma.story.findMany({
      where,
      select: {
        id: true,
        slug: true,
        headline: true,
        synopsis: true,
        confidenceLevel: true,
        sourceCount: true,
        countryCount: true,
        regionCount: true,
        consensusScore: true,
        totalCost: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.story.count({ where }),
  ])

  return Response.json({
    stories,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
