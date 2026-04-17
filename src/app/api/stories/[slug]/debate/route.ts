import { prisma } from '@/lib/db'

// Serve the full debate rounds (including massive content JSON) for a single story.
// Called lazily by DebateHighlights when the user expands the MODEL DEBATE section.
// Caches for 5 minutes to match the ISR on the story page.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  try {
    const story = await prisma.story.findUnique({
      where: { slug },
      select: {
        debateRounds: {
          select: {
            id: true,
            region: true,
            round: true,
            modelName: true,
            provider: true,
            content: true,
            inputTokens: true,
            outputTokens: true,
            costUsd: true,
          },
        },
      },
    })

    if (!story) {
      return Response.json({ error: 'Story not found' }, { status: 404 })
    }

    return Response.json(
      { debateRounds: story.debateRounds },
      {
        headers: {
          'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
        },
      },
    )
  } catch (err) {
    console.error('[api/stories/debate] Failed to fetch:', err)
    return Response.json({ error: 'Failed to fetch debate rounds' }, { status: 500 })
  }
}
