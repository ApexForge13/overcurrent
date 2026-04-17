import { prisma } from '@/lib/db'
import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import {
  isUmbrellaStatus,
  isScanFrequency,
  isSignalCategory,
} from '@/lib/umbrella-validation'

/**
 * GET /api/admin/umbrellas/[id]
 * Returns the umbrella with derived counters. Full detail view (5 sections)
 * is built in Step 5 — this endpoint returns the shape needed for Step 1's
 * card + post-create flow.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params
  const umbrella = await prisma.umbrellaArc.findUnique({
    where: { id },
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
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!umbrella) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ umbrella })
}

/**
 * PUT /api/admin/umbrellas/[id]
 *
 * Accepts partial updates to: name, description, status, signalCategory,
 * scanFrequency, notes. Archive is just `{ status: "archived" }`.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, description, status, signalCategory, scanFrequency, notes } =
    (body ?? {}) as Record<string, unknown>

  const data: Record<string, unknown> = {}

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return Response.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    if (name.trim().length > 200) {
      return Response.json({ error: 'name must be 200 characters or fewer' }, { status: 400 })
    }
    data.name = name.trim()
  }

  if (description !== undefined) {
    data.description =
      typeof description === 'string' && description.trim().length > 0 ? description.trim() : null
  }

  if (status !== undefined) {
    if (!isUmbrellaStatus(status)) {
      return Response.json({ error: 'status must be "active" or "archived"' }, { status: 400 })
    }
    data.status = status
  }

  if (signalCategory !== undefined) {
    if (!isSignalCategory(signalCategory)) {
      return Response.json({ error: 'signalCategory must be one of the 9 signal categories' }, { status: 400 })
    }
    data.signalCategory = signalCategory
  }

  if (scanFrequency !== undefined) {
    if (!isScanFrequency(scanFrequency)) {
      return Response.json({ error: 'scanFrequency must be manual | daily | every_48_hours | weekly' }, { status: 400 })
    }
    data.scanFrequency = scanFrequency
  }

  if (notes !== undefined) {
    data.notes =
      typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  try {
    const umbrella = await prisma.umbrellaArc.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        signalCategory: true,
        scanFrequency: true,
        notes: true,
        updatedAt: true,
      },
    })
    return Response.json({ umbrella })
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}
