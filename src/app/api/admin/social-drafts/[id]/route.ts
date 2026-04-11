import { prisma } from '@/lib/db'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const draft = await prisma.socialDraft.findUnique({ where: { id }, include: { story: true } })
  if (!draft) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(draft)
}

const VALID_DRAFT_STATUSES = ['draft', 'approved', 'rejected', 'scheduled', 'posted']

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { editedContent, status, scheduledFor } = body as {
    editedContent?: string
    status?: string
    scheduledFor?: string | null
  }

  if (editedContent !== undefined && typeof editedContent !== 'string') {
    return Response.json({ error: 'editedContent must be a string' }, { status: 400 })
  }

  if (status !== undefined && !VALID_DRAFT_STATUSES.includes(status)) {
    return Response.json({ error: `Invalid status. Must be one of: ${VALID_DRAFT_STATUSES.join(', ')}` }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (editedContent !== undefined) data.editedContent = editedContent
  if (status !== undefined) data.status = status
  if (scheduledFor !== undefined) data.scheduledFor = scheduledFor ? new Date(scheduledFor) : null

  const draft = await prisma.socialDraft.update({ where: { id }, data })
  return Response.json(draft)
}
