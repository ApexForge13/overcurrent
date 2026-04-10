import { prisma } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const story = await prisma.story.findUnique({
    where: { slug },
    include: {
      sources: true,
      claims: { orderBy: { sortOrder: 'asc' } },
      discrepancies: true,
      omissions: true,
      framings: true,
      silences: true,
      followUps: { orderBy: { sortOrder: 'asc' } },
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  return Response.json(story)
}
