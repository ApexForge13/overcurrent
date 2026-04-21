import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import {
  isSignalCategory,
  isScanFrequency,
  UMBRELLA_STATUSES,
} from '@/lib/umbrella-validation'
import { featureFlags } from '@/lib/feature-flags'

/**
 * GET /api/admin/umbrellas
 *
 * Query params:
 *   status     — "active" | "archived" (omit for all)
 *   category   — signalCategory filter
 *   q          — name substring search
 *   page, limit — pagination (default 1, 50; max 100)
 *
 * Returns umbrella cards with counters: totalAnalyses, storyArcCount, oneOffCount,
 * plus daysActive (derived from firstAnalysisAt or createdAt).
 */
export async function GET(request: NextRequest) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status') ?? undefined
  const category = searchParams.get('category') ?? undefined
  const q = searchParams.get('q')?.trim() ?? undefined
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))

  const where: Record<string, unknown> = {}
  if (status && (UMBRELLA_STATUSES as readonly string[]).includes(status)) where.status = status
  if (category) where.signalCategory = category
  if (q) where.name = { contains: q, mode: 'insensitive' }

  const [umbrellas, total] = await Promise.all([
    prisma.umbrellaArc.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        signalCategory: true,
        scanFrequency: true,
        firstAnalysisAt: true,
        lastAnalysisAt: true,
        totalAnalyses: true,
        storyArcCount: true,
        oneOffCount: true,
        intelligenceScanLastRunAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ status: 'asc' }, { lastAnalysisAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.umbrellaArc.count({ where }),
  ])

  return Response.json({
    umbrellas,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

/**
 * POST /api/admin/umbrellas
 *
 * Body: { name, description?, signalCategory, scanFrequency? }
 * Creates a new active UmbrellaArc.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.DEBATE_PIPELINE_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, description, signalCategory, scanFrequency } = (body ?? {}) as {
    name?: unknown
    description?: unknown
    signalCategory?: unknown
    scanFrequency?: unknown
  }

  if (typeof name !== 'string' || name.trim().length === 0) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }
  if (name.trim().length > 200) {
    return Response.json({ error: 'name must be 200 characters or fewer' }, { status: 400 })
  }
  if (!isSignalCategory(signalCategory)) {
    return Response.json({ error: 'signalCategory is required and must be one of the 9 signal categories' }, { status: 400 })
  }
  if (scanFrequency !== undefined && !isScanFrequency(scanFrequency)) {
    return Response.json({ error: 'scanFrequency must be manual | daily | every_48_hours | weekly' }, { status: 400 })
  }
  const descriptionValue =
    typeof description === 'string' && description.trim().length > 0 ? description.trim() : null

  const umbrella = await prisma.umbrellaArc.create({
    data: {
      name: name.trim(),
      description: descriptionValue,
      signalCategory,
      scanFrequency: isScanFrequency(scanFrequency) ? scanFrequency : 'manual',
      status: 'active',
    },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      signalCategory: true,
      scanFrequency: true,
      createdAt: true,
    },
  })

  return Response.json({ umbrella }, { status: 201 })
}
