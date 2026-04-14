import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status') ?? undefined
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  const where: Record<string, unknown> = {}
  if (status) where.status = status

  const [stories, total] = await Promise.all([
    prisma.story.findMany({
      where,
      select: {
        id: true, slug: true, headline: true, synopsis: true,
        confidenceLevel: true, sourceCount: true, countryCount: true,
        regionCount: true, consensusScore: true, totalCost: true,
        primaryCategory: true, status: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.story.count({ where }),
  ])

  return Response.json({ stories, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
}
