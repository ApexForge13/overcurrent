import { prisma } from '@/lib/db'

export async function POST() {
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
