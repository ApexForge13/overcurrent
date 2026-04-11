import { prisma } from '@/lib/db'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const { status, headline, synopsis } = body

  const data: Record<string, unknown> = {}
  if (status !== undefined) data.status = status
  if (headline !== undefined) data.headline = headline
  if (synopsis !== undefined) data.synopsis = synopsis
  if (status === 'published') data.publishedAt = new Date()

  const story = await prisma.story.update({ where: { id }, data })
  return Response.json(story)
}
