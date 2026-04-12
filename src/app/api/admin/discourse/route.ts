import { prisma } from '@/lib/db'

export async function POST(request: Request) {
  try {
    const { storyId, platform, posts } = await request.json()
    if (!storyId || !platform || !Array.isArray(posts)) {
      return Response.json({ error: 'storyId, platform, and posts required' }, { status: 400 })
    }

    const snapshot = await prisma.discourseSnapshot.create({
      data: {
        storyId,
        platform,
        totalEngagement: posts.reduce((n: number, p: { views?: number; likes?: number }) => n + (p.views || 0) + (p.likes || 0), 0),
        postCount: posts.length,
      },
    })

    if (posts.length > 0) {
      await prisma.discoursePost.createMany({
        data: posts.map((p: { url?: string; caption?: string; content?: string; views?: number; likes?: number; framingType?: string }, i: number) => ({
          snapshotId: snapshot.id,
          platform,
          url: p.url || null,
          content: p.caption || p.content || '',
          views: p.views || null,
          upvotes: p.likes || 0,
          framingType: p.framingType || null,
          sortOrder: i,
        })),
      })
    }

    return Response.json({ success: true, snapshotId: snapshot.id })
  } catch {
    return Response.json({ error: 'Failed to save' }, { status: 500 })
  }
}
