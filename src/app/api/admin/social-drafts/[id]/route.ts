import { prisma } from '@/lib/db'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const draft = await prisma.socialDraft.findUnique({ where: { id }, include: { story: true } })
  if (!draft) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(draft)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const { editedContent, status, scheduledFor } = body

  const data: Record<string, unknown> = {}
  if (editedContent !== undefined) data.editedContent = editedContent
  if (status !== undefined) data.status = status
  if (scheduledFor !== undefined) data.scheduledFor = scheduledFor ? new Date(scheduledFor) : null

  const draft = await prisma.socialDraft.update({ where: { id }, data })
  return Response.json(draft)
}
