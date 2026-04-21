import { prisma } from '@/lib/db'
import { featureFlags } from '@/lib/feature-flags'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
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
      versions: { orderBy: { versionNumber: 'desc' as const } },
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  return Response.json(story)
}
