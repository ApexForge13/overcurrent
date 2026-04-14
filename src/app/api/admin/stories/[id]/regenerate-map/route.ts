import { prisma } from '@/lib/db'
import { classifyMapRegions, type CountryClassification } from '@/agents/map-classifier'
import { requireAdmin } from '@/lib/auth-guard'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await params

  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      sources: true,
      framings: true,
      discrepancies: true,
      claims: { orderBy: { sortOrder: 'asc' } },
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  // Run classification agent — reads the actual analysis data
  const { classifications, costUsd } = await classifyMapRegions({
    headline: story.headline,
    synopsis: story.synopsis,
    sources: story.sources.map(s => ({
      outlet: s.outlet,
      country: s.country,
      region: s.region,
      politicalLean: s.politicalLean,
    })),
    framings: story.framings,
    discrepancies: story.discrepancies,
    claims: story.claims.map(c => ({
      claim: c.claim,
      confidence: c.confidence,
      supportedBy: c.supportedBy,
      contradictedBy: c.contradictedBy,
    })),
  }, story.id)

  console.log(`[regen-map] Classification agent returned ${classifications.length} regions ($${costUsd.toFixed(4)})`)
  for (const c of classifications) {
    console.log(`[regen-map]   ${c.region_id}: border=${c.border_status}, fill=${c.fill_status}, "${c.dominant_framing}"`)
  }

  // Build timeline from classifications
  const reportDate = story.createdAt
  const dateLabel = reportDate.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  // Sort: original first, then contradicted, then reframed, then wire_copy
  const statusOrder: Record<string, number> = { original: 0, contradicted: 1, reframed: 2, wire_copy: 3 }
  const sorted = [...classifications].sort((a, b) =>
    (statusOrder[a.fill_status] ?? 3) - (statusOrder[b.fill_status] ?? 3)
  )

  // Build 6 progressive frames
  const frameLabels = [
    'Story breaks',
    'Wire services pick up',
    'Regional outlets respond',
    'Global coverage spreads',
    'Counter-narratives emerge',
    'Full global picture',
  ]

  const timeline = []
  for (let i = 0; i < 6; i++) {
    const count = Math.max(1, Math.ceil(sorted.length * (i + 1) / 6))
    const regionsInFrame = sorted.slice(0, count).map(c => ({
      region_id: c.region_id,
      status: c.fill_status, // Globe uses this for country fill color
      border_status: c.border_status, // Globe uses this for border color
      coverage_volume: Math.min(100, c.outlet_count * 12),
      dominant_quote: c.dominant_framing,
      outlet_count: c.outlet_count,
      key_outlets: c.outlets.slice(0, 5),
    }))

    // Build flows from original regions to others
    const originRegions = regionsInFrame.filter(r => r.border_status === 'original')
    const flows: Array<{ from: string; to: string; type: string }> = []

    for (const origin of originRegions) {
      for (const r of regionsInFrame) {
        if (r.region_id === origin.region_id) continue
        const key = `${origin.region_id}-${r.region_id}`
        if (flows.some(f => `${f.from}-${f.to}` === key)) continue
        flows.push({ from: origin.region_id, to: r.region_id, type: r.status })
      }
    }

    // Cross-flows between contradicted/reframed regions
    const nonOrigin = regionsInFrame.filter(r => r.border_status !== 'original')
    for (let a = 0; a < nonOrigin.length && flows.length < 30; a++) {
      for (let b = a + 1; b < nonOrigin.length && flows.length < 30; b++) {
        if (nonOrigin[a].status !== nonOrigin[b].status) {
          flows.push({ from: nonOrigin[a].region_id, to: nonOrigin[b].region_id, type: 'reframed' })
        }
      }
    }

    timeline.push({
      hour: i * 4,
      label: dateLabel,
      description: frameLabels[i],
      regions: regionsInFrame,
      flows,
    })
  }

  // Store classifications + timeline
  const existing = story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
  existing.propagationTimeline = timeline
  existing.mapClassifications = classifications

  await prisma.story.update({
    where: { id },
    data: { confidenceNote: JSON.stringify(existing) },
  })

  return Response.json({
    success: true,
    frames: 6,
    regions: classifications.length,
    date: dateLabel,
    cost: `$${costUsd.toFixed(4)}`,
    classifications: classifications.map(c => ({
      region: c.region_id,
      border: c.border_status,
      fill: c.fill_status,
      framing: c.dominant_framing,
    })),
  })
}
