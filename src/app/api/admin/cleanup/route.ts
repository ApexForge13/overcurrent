import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

export async function POST() {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  // Delete stories with junk headlines from testing
  const junkPatterns = [
    'No Coverage Found',
    'No Evidence',
    'Insufficient',
    'Fictional',
    'Cannot Verify',
    'Lacks Global',
  ]

  const stories = await prisma.story.findMany({
    select: { id: true, headline: true },
  })

  const toDelete = stories.filter(s =>
    junkPatterns.some(p => s.headline.includes(p))
  )

  let deleted = 0
  for (const story of toDelete) {
    await prisma.story.delete({ where: { id: story.id } })
    deleted++
  }

  const remaining = await prisma.story.count()

  return Response.json({
    deleted,
    remaining,
    deletedHeadlines: toDelete.map(s => s.headline.substring(0, 60)),
  })
}
