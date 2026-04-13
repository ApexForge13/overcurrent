import { prisma } from '@/lib/db'

/** Map country code → globe region ID */
function mapCountryToRegionId(country: string): string {
  const map: Record<string, string> = {
    US: 'us', CA: 'ca', MX: 'mx',
    GB: 'uk', IE: 'uk',
    FR: 'eu', DE: 'eu', IT: 'eu', ES: 'eu', NL: 'eu', SE: 'eu', NO: 'eu', BE: 'eu',
    CH: 'eu', CZ: 'eu', DK: 'eu', FI: 'eu', GR: 'eu', HU: 'eu', PL: 'eu', PT: 'eu', UA: 'eu',
    RU: 'ru', TR: 'tr', IR: 'ir', IL: 'il',
    SA: 'me', QA: 'me', AE: 'me', EG: 'me',
    KE: 'af', ZA: 'af', NG: 'af', GH: 'af', ET: 'af', TZ: 'af',
    IN: 'in', PK: 'pk', BD: 'in', LK: 'in', NP: 'in', AF: 'in',
    CN: 'cn', JP: 'jp', KR: 'kr', HK: 'cn', TW: 'cn',
    SG: 'sea', TH: 'sea', ID: 'sea', MY: 'sea', PH: 'sea', VN: 'sea',
    AU: 'au', NZ: 'au',
    BR: 'la', AR: 'la', CO: 'la', CL: 'la', PE: 'la', VE: 'la', UY: 'la',
    KZ: 'in', KG: 'in',
  }
  return map[country] || 'us'
}

function formatTimelineLabel(date: Date, totalSpanMs: number): string {
  const hours = totalSpanMs / (1000 * 60 * 60)
  if (hours < 24) {
    return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })
  } else if (hours < 168) {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'UTC' })
  } else {
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Fetch story + all its sources
  const story = await prisma.story.findUnique({
    where: { id },
    include: { sources: true },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  // Build timeline from source publishedAt timestamps
  const sourcesWithDates = story.sources
    .filter(s => s.publishedAt)
    .map(s => ({ ...s, date: new Date(s.publishedAt!) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (sourcesWithDates.length === 0) {
    // No timestamps — build a single frame from all sources
    const regionMap = new Map<string, { outlets: Set<string>; country: string }>()
    for (const s of story.sources) {
      const rid = mapCountryToRegionId(s.country)
      if (!regionMap.has(rid)) regionMap.set(rid, { outlets: new Set(), country: s.country })
      regionMap.get(rid)!.outlets.add(s.outlet)
    }

    const singleFrame = {
      hour: 0,
      label: 'All sources',
      description: `${story.sources.length} sources across ${regionMap.size} regions`,
      regions: Array.from(regionMap.entries()).map(([rid, d], i) => ({
        region_id: rid,
        status: i === 0 ? 'original' : 'wire_copy',
        coverage_volume: Math.min(100, d.outlets.size * 15),
        dominant_quote: `${d.outlets.size} outlets covering`,
        outlet_count: d.outlets.size,
        key_outlets: Array.from(d.outlets).slice(0, 5),
      })),
      flows: [] as Array<{ from: string; to: string; type: string }>,
    }

    // Add flows from first region to all others
    if (singleFrame.regions.length >= 2) {
      const origin = singleFrame.regions[0].region_id
      for (let r = 1; r < singleFrame.regions.length; r++) {
        singleFrame.flows.push({
          from: origin,
          to: singleFrame.regions[r].region_id,
          type: singleFrame.regions[r].status,
        })
      }
    }

    const timeline = [singleFrame]

    // Update story
    const existing = story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
    existing.propagationTimeline = timeline

    await prisma.story.update({
      where: { id },
      data: { confidenceNote: JSON.stringify(existing) },
    })

    return Response.json({ success: true, frames: 1, regions: singleFrame.regions.length })
  }

  // Build 6 cumulative time buckets
  const earliest = sourcesWithDates[0].date.getTime()
  const latest = sourcesWithDates[sourcesWithDates.length - 1].date.getTime()
  const span = Math.max(latest - earliest, 60_000)
  const bucketCount = 6
  const bucketSize = span / bucketCount

  const timeline = []

  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = earliest + (i * bucketSize)
    const bucketEnd = earliest + ((i + 1) * bucketSize)
    const bucketDate = new Date(bucketStart)

    // Cumulative: all sources published up to this bucket's end
    const upTo = sourcesWithDates.filter(s => s.date.getTime() <= bucketEnd)

    const regionMap = new Map<string, { outlets: Set<string>; country: string }>()
    for (const s of upTo) {
      const rid = mapCountryToRegionId(s.country)
      if (!regionMap.has(rid)) regionMap.set(rid, { outlets: new Set(), country: s.country })
      regionMap.get(rid)!.outlets.add(s.outlet)
    }

    const regions = Array.from(regionMap.entries()).map(([rid, d], ri) => ({
      region_id: rid,
      status: ri === 0 && i === 0 ? 'original' : 'wire_copy',
      coverage_volume: Math.min(100, d.outlets.size * 15),
      dominant_quote: `${d.outlets.size} outlets covering`,
      outlet_count: d.outlets.size,
      key_outlets: Array.from(d.outlets).slice(0, 5),
    }))

    const flows: Array<{ from: string; to: string; type: string }> = []
    if (regions.length >= 2) {
      const origin = regions[0].region_id
      for (let r = 1; r < regions.length; r++) {
        flows.push({ from: origin, to: regions[r].region_id, type: regions[r].status })
      }
    }

    timeline.push({
      hour: Math.round((bucketStart - earliest) / (1000 * 60 * 60)),
      label: formatTimelineLabel(bucketDate, span),
      description: `${regions.length} regions, ${regions.reduce((n, r) => n + r.outlet_count, 0)} outlets`,
      regions,
      flows,
    })
  }

  // Update story's confidenceNote with new timeline
  const existing = story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
  existing.propagationTimeline = timeline

  await prisma.story.update({
    where: { id },
    data: { confidenceNote: JSON.stringify(existing) },
  })

  const totalRegions = new Set(timeline.flatMap(f => f.regions.map(r => r.region_id))).size

  return Response.json({
    success: true,
    frames: timeline.length,
    regions: totalRegions,
    span: `${Math.round(span / (1000 * 60 * 60))} hours`,
  })
}
