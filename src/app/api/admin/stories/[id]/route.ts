import { prisma } from '@/lib/db'

const VALID_STATUSES = ['draft', 'review', 'published', 'archived', 'rejected']

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status, headline, synopsis } = body as { status?: string; headline?: string; synopsis?: string }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return Response.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  if (headline !== undefined && typeof headline !== 'string') {
    return Response.json({ error: 'headline must be a string' }, { status: 400 })
  }

  if (synopsis !== undefined && typeof synopsis !== 'string') {
    return Response.json({ error: 'synopsis must be a string' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (status !== undefined) data.status = status
  if (headline !== undefined) data.headline = headline
  if (synopsis !== undefined) data.synopsis = synopsis
  if (status === 'published') data.publishedAt = new Date()

  const story = await prisma.story.update({ where: { id }, data })
  return Response.json(story)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    await prisma.story.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    console.error('Failed to delete story:', err)
    return Response.json({ error: 'Story not found or delete failed' }, { status: 404 })
  }
}
