import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

export async function GET() {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  // Get published stories from the last 7 days
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const stories = await prisma.story.findMany({
    where: {
      status: 'published',
      createdAt: { gte: weekAgo },
    },
    select: {
      slug: true,
      headline: true,
      synopsis: true,
      confidenceLevel: true,
      consensusScore: true,
      sourceCount: true,
      countryCount: true,
      primaryCategory: true,
      confidenceNote: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  if (stories.length === 0) {
    return Response.json({ subject: 'No stories this week', html: '', text: '' })
  }

  // Extract The Pattern from each story
  const storyDigests = stories.map(s => {
    let thePattern = ''
    try {
      const parsed = JSON.parse(s.confidenceNote || '{}')
      thePattern = parsed.note || ''
    } catch { /* skip */ }

    return {
      headline: s.headline,
      slug: s.slug,
      synopsis: s.synopsis?.replace(/<[^>]*>/g, '').substring(0, 200),
      confidenceLevel: s.confidenceLevel,
      consensusScore: s.consensusScore,
      sourceCount: s.sourceCount,
      countryCount: s.countryCount,
      category: s.primaryCategory,
      thePattern,
    }
  })

  const subject = `Overcurrent Weekly: ${storyDigests[0].headline}`

  // Generate plain text version
  const text = `OVERCURRENT WEEKLY DIGEST\n\n${storyDigests.map((s, i) =>
    `${i + 1}. ${s.headline}\n${s.confidenceLevel} CONFIDENCE · ${s.consensusScore}% consensus · ${s.sourceCount} sources\n${s.synopsis}...\nhttps://overcurrent.news/story/${s.slug}\n`
  ).join('\n')}\n\nYou're receiving this because you subscribed to Overcurrent.\nUnsubscribe: https://overcurrent.news/api/unsubscribe?email=SUBSCRIBER_EMAIL`

  // Generate HTML version
  const html = `<!DOCTYPE html><html><body style="background:#0A0A0B;color:#E8E6E3;font-family:'IBM Plex Sans',sans-serif;padding:32px;max-width:600px;margin:0 auto">
<h1 style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;margin-bottom:24px">OVERCURRENT</h1>
<p style="font-size:13px;color:#9A9894;margin-bottom:24px">Weekly digest — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
${storyDigests.map((s) => `
<div style="border-top:1px solid #2A2A2E;padding:20px 0">
<p style="font-family:monospace;font-size:11px;color:#9A9894;margin-bottom:4px">${(s.category || '').toUpperCase()} · ${s.confidenceLevel} · ${s.consensusScore}%</p>
<h2 style="font-family:'Playfair Display',serif;font-size:18px;font-weight:600;margin-bottom:8px"><a href="https://overcurrent.news/story/${s.slug}" style="color:#E8E6E3;text-decoration:none">${s.headline}</a></h2>
<p style="font-size:14px;color:#9A9894;line-height:1.6">${s.synopsis}...</p>
<p style="font-family:monospace;font-size:11px;color:#5C5A56;margin-top:8px">${s.sourceCount} sources · ${s.countryCount} countries</p>
</div>
`).join('')}
<div style="border-top:1px solid #2A2A2E;padding:20px 0;font-size:11px;color:#5C5A56">
<p>Every outlet shows you their version. We show you everyone's.</p>
<p style="margin-top:8px"><a href="https://overcurrent.news/api/unsubscribe?email=SUBSCRIBER_EMAIL" style="color:#457B9D">Unsubscribe</a></p>
</div>
</body></html>`

  const subscriberCount = await prisma.subscriber.count({ where: { status: 'active' } })

  return Response.json({
    subject,
    html,
    text,
    storyCount: storyDigests.length,
    subscriberCount,
    preview: `${storyDigests.length} stories for ${subscriberCount} subscribers`,
  })
}
