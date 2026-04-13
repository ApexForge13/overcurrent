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

/** Region IDs that are known state-media-heavy → likely reframed */
const STATE_MEDIA_REGIONS = new Set(['ru', 'cn', 'ir', 'tr'])

/** Determine status for a region based on its sources and story context */
function determineRegionStatus(
  regionId: string,
  sources: Array<{ politicalLean: string; reliability: string; country: string }>,
  isFirst: boolean,
  contradictedRegions: Set<string>,
  reframedRegions: Set<string>,
): string {
  // Check if discrepancy/framing analysis flagged this region
  if (contradictedRegions.has(regionId)) return 'contradicted'
  if (reframedRegions.has(regionId)) return 'reframed'

  // First region to publish = original
  if (isFirst) return 'original'

  // State-controlled outlets → reframed
  const hasStateMedia = sources.some(s => s.politicalLean === 'state-controlled')
  if (hasStateMedia && STATE_MEDIA_REGIONS.has(regionId)) return 'reframed'

  // Low reliability outlets → reframed
  const allLow = sources.every(s => s.reliability === 'low')
  if (allLow) return 'reframed'

  // Default: wire_copy
  return 'wire_copy'
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

  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      sources: true,
      discrepancies: true,
      framings: true,
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  // Build sets of regions that have discrepancies or divergent framing
  const contradictedRegions = new Set<string>()
  const reframedRegions = new Set<string>()

  for (const d of story.discrepancies) {
    // Discrepancy sources mention regions — try to map them
    const allText = `${d.sourcesA} ${d.sourcesB}`.toLowerCase()
    if (allText.includes('rt') || allText.includes('russia') || allText.includes('tass')) contradictedRegions.add('ru')
    if (allText.includes('cgtn') || allText.includes('china') || allText.includes('xinhua') || allText.includes('global times')) contradictedRegions.add('cn')
    if (allText.includes('press tv') || allText.includes('iran') || allText.includes('tasnim')) contradictedRegions.add('ir')
    if (allText.includes('al jazeera') || allText.includes('qatar')) reframedRegions.add('me')
    if (allText.includes('trt') || allText.includes('turkey') || allText.includes('anadolu')) reframedRegions.add('tr')
  }

  for (const f of story.framings) {
    const region = f.region.toLowerCase()
    if (f.contrastWith && f.contrastWith.length > 10) {
      // This region has contrasting framing — it's reframed
      if (region.includes('russia')) reframedRegions.add('ru')
      if (region.includes('china')) reframedRegions.add('cn')
      if (region.includes('middle east')) reframedRegions.add('me')
      if (region.includes('iran')) reframedRegions.add('ir')
      if (region.includes('turkey')) reframedRegions.add('tr')
      if (region.includes('latin')) reframedRegions.add('la')
      if (region.includes('india') || region.includes('south asia')) reframedRegions.add('in')
    }
  }

  // Group sources by region ID with metadata
  const regionSources = new Map<string, Array<{ outlet: string; politicalLean: string; reliability: string; country: string; publishedAt: Date | null }>>()
  for (const s of story.sources) {
    const rid = mapCountryToRegionId(s.country)
    if (!regionSources.has(rid)) regionSources.set(rid, [])
    regionSources.get(rid)!.push({
      outlet: s.outlet,
      politicalLean: s.politicalLean,
      reliability: s.reliability,
      country: s.country,
      publishedAt: s.publishedAt,
    })
  }

  // Determine which region published first (by earliest publishedAt)
  let firstRegion = 'us'
  let earliestTime = Infinity
  for (const [rid, sources] of regionSources) {
    for (const s of sources) {
      if (s.publishedAt && s.publishedAt.getTime() < earliestTime) {
        earliestTime = s.publishedAt.getTime()
        firstRegion = rid
      }
    }
  }

  // Sort all sources by time for bucketing
  const sourcesWithDates = story.sources
    .filter(s => s.publishedAt)
    .map(s => ({ ...s, date: new Date(s.publishedAt!) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  // Build timeline frames
  const allSources = story.sources
  const bucketCount = 6

  if (sourcesWithDates.length === 0) {
    // No timestamps — single frame with all sources, intelligent statuses
    const regions = Array.from(regionSources.entries()).map(([rid, sources]) => ({
      region_id: rid,
      status: determineRegionStatus(rid, sources, rid === firstRegion, contradictedRegions, reframedRegions),
      coverage_volume: Math.min(100, sources.length * 12),
      dominant_quote: `${sources.length} outlets covering`,
      outlet_count: sources.length,
      key_outlets: [...new Set(sources.map(s => s.outlet))].slice(0, 5),
    }))

    // Build diverse flows — from origin to each region, with correct type
    const flows = buildFlows(regions, firstRegion)

    const timeline = [{
      hour: 0,
      label: 'All sources',
      description: `${regions.length} regions, ${allSources.length} outlets`,
      regions,
      flows,
    }]

    const existing = story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
    existing.propagationTimeline = timeline
    await prisma.story.update({ where: { id }, data: { confidenceNote: JSON.stringify(existing) } })

    return Response.json({ success: true, frames: 1, regions: regions.length })
  }

  // Bucketed timeline
  const earliest = sourcesWithDates[0].date.getTime()
  const latest = sourcesWithDates[sourcesWithDates.length - 1].date.getTime()
  const span = Math.max(latest - earliest, 60_000)
  const bucketSize = span / bucketCount

  const timeline = []

  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = earliest + (i * bucketSize)
    const bucketEnd = earliest + ((i + 1) * bucketSize)
    const bucketDate = new Date(bucketStart)

    // Cumulative sources up to this bucket
    const upTo = sourcesWithDates.filter(s => s.date.getTime() <= bucketEnd)

    // Group by region
    const bucketRegionMap = new Map<string, Array<{ outlet: string; politicalLean: string; reliability: string; country: string }>>()
    for (const s of upTo) {
      const rid = mapCountryToRegionId(s.country)
      if (!bucketRegionMap.has(rid)) bucketRegionMap.set(rid, [])
      bucketRegionMap.get(rid)!.push({ outlet: s.outlet, politicalLean: s.politicalLean, reliability: s.reliability, country: s.country })
    }

    const regions = Array.from(bucketRegionMap.entries()).map(([rid, sources]) => {
      const isFirst = rid === firstRegion && i === 0
      return {
        region_id: rid,
        status: determineRegionStatus(rid, sources, isFirst, contradictedRegions, reframedRegions),
        coverage_volume: Math.min(100, sources.length * 12),
        dominant_quote: `${[...new Set(sources.map(s => s.outlet))].length} outlets covering`,
        outlet_count: [...new Set(sources.map(s => s.outlet))].length,
        key_outlets: [...new Set(sources.map(s => s.outlet))].slice(0, 5),
      }
    })

    const flows = buildFlows(regions, firstRegion)

    timeline.push({
      hour: Math.round((bucketStart - earliest) / (1000 * 60 * 60)),
      label: formatTimelineLabel(bucketDate, span),
      description: `${regions.length} regions, ${upTo.length} outlets`,
      regions,
      flows,
    })
  }

  const existing = story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
  existing.propagationTimeline = timeline
  await prisma.story.update({ where: { id }, data: { confidenceNote: JSON.stringify(existing) } })

  const totalRegions = new Set(timeline.flatMap(f => f.regions.map(r => r.region_id))).size

  return Response.json({
    success: true,
    frames: timeline.length,
    regions: totalRegions,
    span: `${Math.round(span / (1000 * 60 * 60))} hours`,
  })
}

/** Build flows between regions with correct types and diverse origins */
function buildFlows(
  regions: Array<{ region_id: string; status: string }>,
  originRegionId: string,
): Array<{ from: string; to: string; type: string }> {
  if (regions.length < 2) return []

  const flows: Array<{ from: string; to: string; type: string }> = []
  const origin = regions.find(r => r.region_id === originRegionId) || regions.find(r => r.status === 'original') || regions[0]

  // Primary flows: origin → each other region
  for (const r of regions) {
    if (r.region_id === origin.region_id) continue
    flows.push({
      from: origin.region_id,
      to: r.region_id,
      type: r.status, // wire_copy = blue, reframed = amber, contradicted = red
    })
  }

  // Cross-flows between regions with different statuses (max 5 to avoid clutter)
  let crossCount = 0
  for (let i = 0; i < regions.length && crossCount < 5; i++) {
    for (let j = i + 1; j < regions.length && crossCount < 5; j++) {
      const a = regions[i]
      const b = regions[j]
      if (a.region_id === origin.region_id || b.region_id === origin.region_id) continue
      if (a.status !== b.status) {
        flows.push({ from: a.region_id, to: b.region_id, type: 'reframed' })
        crossCount++
      }
    }
  }

  return flows
}
