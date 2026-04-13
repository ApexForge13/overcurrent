import { prisma } from '@/lib/db'
import { generateSocialDrafts } from '@/agents/social-drafts'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      claims: { orderBy: { sortOrder: 'asc' } },
      discrepancies: true,
      omissions: true,
      framings: true,
      sources: true,
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  // Reconstruct the analysis data object that generateSocialDrafts expects
  const countries = new Set(story.sources.map(s => s.country))
  const regions = new Set(story.sources.map(s => s.region))

  // Run post-synthesis verification: check omission claims against source list
  const verifiedOmissions = story.omissions.map(o => {
    const corrected = verifyClaim(o.missing, o.outletRegion, story.sources)
    return corrected ? { ...o, missing: corrected } : o
  })

  const analysisData = {
    headline: story.headline,
    synopsis: story.synopsis,
    confidenceLevel: story.confidenceLevel,
    consensusScore: story.consensusScore,
    sourceCount: story.sources.length,
    countryCount: countries.size,
    regionCount: regions.size,
    claims: story.claims.map(c => ({
      claim: c.claim,
      confidence: c.confidence,
      consensusPct: c.consensusPct,
      supportedBy: c.supportedBy,
      contradictedBy: c.contradictedBy,
      notes: c.notes,
    })),
    discrepancies: story.discrepancies.map(d => ({
      issue: d.issue,
      sideA: d.sideA,
      sideB: d.sideB,
      sourcesA: d.sourcesA,
      sourcesB: d.sourcesB,
      assessment: d.assessment,
    })),
    omissions: verifiedOmissions.map(o => ({
      outletRegion: o.outletRegion,
      missing: o.missing,
      presentIn: o.presentIn,
      significance: o.significance,
    })),
    framings: story.framings.map(f => ({
      region: f.region,
      framing: f.framing,
      contrastWith: f.contrastWith,
    })),
  }

  try {
    const drafts = await generateSocialDrafts(analysisData, story.id)

    if (drafts.length > 0) {
      // Delete old drafts for this story
      await prisma.socialDraft.deleteMany({ where: { storyId: story.id } })

      // Save new drafts
      await prisma.socialDraft.createMany({
        data: drafts.map((d) => ({
          storyId: story.id,
          platform: d.platform,
          content: d.content,
          metadata: d.metadata ? JSON.stringify(d.metadata) : null,
          status: 'draft',
        })),
      })
    }

    return Response.json({
      success: true,
      drafts: drafts.length,
      platforms: [...new Set(drafts.map(d => d.platform))],
    })
  } catch (err) {
    console.error('Social draft regeneration failed:', err)
    return Response.json({
      error: err instanceof Error ? err.message : 'Generation failed',
    }, { status: 500 })
  }
}

/** Check if an omission claim contradicts the actual source list */
function verifyClaim(
  missing: string,
  outletRegion: string,
  sources: Array<{ outlet: string; country: string; region: string }>,
): string | null {
  const lower = missing.toLowerCase()

  // Country-level contradiction patterns
  const countryChecks: Array<{ keywords: string[]; countryCode: string; name: string }> = [
    { keywords: ['pakistani', 'pakistan'], countryCode: 'PK', name: 'Pakistani' },
    { keywords: ['iranian', 'iran'], countryCode: 'IR', name: 'Iranian' },
    { keywords: ['chinese', 'china'], countryCode: 'CN', name: 'Chinese' },
    { keywords: ['russian', 'russia'], countryCode: 'RU', name: 'Russian' },
    { keywords: ['turkish', 'turkey', 'türkiye'], countryCode: 'TR', name: 'Turkish' },
    { keywords: ['indian', 'india'], countryCode: 'IN', name: 'Indian' },
    { keywords: ['japanese', 'japan'], countryCode: 'JP', name: 'Japanese' },
    { keywords: ['european', 'europe'], countryCode: '', name: 'European' },
  ]

  // Check for "zero/no/absence" + country claims
  const hasAbsenceClaim = /\b(zero|no |absence|silent|missing|none found|not found)\b/i.test(lower)
  if (!hasAbsenceClaim) return null

  for (const check of countryChecks) {
    if (!check.keywords.some(kw => lower.includes(kw))) continue

    const matchingSources = check.countryCode
      ? sources.filter(s => s.country === check.countryCode)
      : sources.filter(s => s.region === 'Europe')

    if (matchingSources.length > 0) {
      const outletNames = [...new Set(matchingSources.map(s => s.outlet))].join(', ')
      console.log(`[verification] Synthesis claimed zero ${check.name} coverage but source list contains: ${outletNames}`)
      return `${check.name} outlets (${outletNames}) were included in the analysis but provided limited direct coverage of the talks compared to other regions`
    }
  }

  return null
}
