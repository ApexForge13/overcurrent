import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status') ?? undefined
  const platform = searchParams.get('platform') ?? undefined
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (platform) where.platform = platform

  const [drafts, total] = await Promise.all([
    prisma.socialDraft.findMany({
      where,
      include: {
        story: { select: { id: true, slug: true, headline: true, confidenceLevel: true, consensusScore: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.socialDraft.count({ where }),
  ])

  return Response.json({ drafts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
}
