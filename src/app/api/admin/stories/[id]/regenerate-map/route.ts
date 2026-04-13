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
/**
 * Determine status for each region. Uses three data sources:
 * 1. Story headline/synopsis → which countries are PARTIES to the story (original)
 * 2. Discrepancy/framing data → which regions actively disagree (contradicted/reframed)
 * 3. Outlet metadata → state media detection (reframed)
 *
 * Status priority: original > contradicted > reframed > wire_copy
 *
 * "original" = this region is a PARTY to the events (US, Iran, Pakistan for this story)
 * "reframed" = this region covered the story but with a different editorial angle
 * "contradicted" = this region's coverage directly disputes key facts
 * "wire_copy" = this region ran the story largely from wire services
 */
function determineRegionStatus(
  regionId: string,
  sources: Array<{ outlet: string; politicalLean: string; reliability: string; country: string }>,
  headline: string,
  synopsis: string,
  contradictedRegions: Set<string>,
  reframedRegions: Set<string>,
): string {
  const storyText = `${headline} ${synopsis}`.toLowerCase()

  // Only the PARTIES to the story get original. Very strict matching.
  // These are the countries whose governments/institutions are actors in the events.
  const partyKeywords: Record<string, string[]> = {
    'us': ['united states', 'u.s.', 'trump', 'vance', 'pentagon', 'white house', 'centcom', 'us navy', 'us-iran'],
    'pk': ['pakistan', 'islamabad'],
    'ir': ['iran', 'iranian', 'ghalibaf', 'hormuz'],
  }

  const partyMatches = partyKeywords[regionId]
  if (partyMatches && partyMatches.some(kw => storyText.includes(kw))) {
    return 'original'
  }

  // Contradicted from discrepancy data
  if (contradictedRegions.has(regionId)) return 'contradicted'

  // State-controlled outlets → reframed
  const hasStateMedia = sources.some(s => s.politicalLean === 'state-controlled')
  if (hasStateMedia && STATE_MEDIA_REGIONS.has(regionId)) return 'reframed'

  // Reframed from framing analysis
  if (reframedRegions.has(regionId)) return 'reframed'

  // Regions with many independent outlets doing their own analysis = reframed
  // (they have their own editorial angle, not just wire copy)
  const uniqueOutlets = new Set(sources.map(s => s.outlet)).size
  if (uniqueOutlets >= 4) return 'reframed'

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

  // Build framing quotes map: region_id → dominant quote from framings
  const framingQuotes = new Map<string, string>()
  const regionNameToId: Record<string, string> = {
    'north america': 'us', 'europe': 'eu', 'middle east': 'me',
    'asia-pacific': 'sea', 'asia pacific': 'sea',
    'south asia': 'in', 'south & central asia': 'in',
    'latin america': 'la', 'russia': 'ru', 'china': 'cn',
    'iran': 'ir', 'israel': 'il', 'turkey': 'tr', 'pakistan': 'pk',
    'india': 'in', 'japan': 'jp', 'australia': 'au', 'uk': 'uk',
    'middle east & africa': 'me',
  }
  for (const f of story.framings) {
    const key = f.region.toLowerCase()
    for (const [name, rid] of Object.entries(regionNameToId)) {
      if (key.includes(name)) {
        framingQuotes.set(rid, f.framing.substring(0, 60))
        break
      }
    }
  }

  // Inherit framing quotes: country-level IDs inherit from parent macro-region
  const regionInheritance: Record<string, string> = {
    ca: 'us', mx: 'us',          // North America children inherit from us
    uk: 'eu',                      // UK inherits from Europe
    ru: 'eu',                      // Russia inherits from Europe (if no own framing)
    jp: 'sea', kr: 'sea', au: 'sea', // Asia-Pacific children
    pk: 'in',                      // Pakistan inherits from South Asia
    ir: 'me', il: 'me', tr: 'me', af: 'me', // Middle East children
    la: 'la',                      // Latin America
  }
  for (const [child, parent] of Object.entries(regionInheritance)) {
    if (!framingQuotes.has(child) && framingQuotes.has(parent)) {
      framingQuotes.set(child, framingQuotes.get(parent)!)
    }
  }

  console.log(`[regen-map] Framing quotes mapped: ${[...framingQuotes.entries()].map(([k, v]) => `${k}="${v.substring(0, 30)}"`).join(', ')}`)

  // ── BUILD 6 PROGRESSIVE FRAMES ────────────────────────────────────────
  const reportDate = story.createdAt
  const dateLabel = reportDate.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  const sortedRegions = Array.from(regionSources.entries())
    .map(([rid, sources]) => {
      const uniqueOutlets = [...new Set(sources.map(s => s.outlet))]
      return {
        region_id: rid,
        status: determineRegionStatus(rid, sources, story.headline, story.synopsis || '', contradictedRegions, reframedRegions),
        coverage_volume: Math.min(100, sources.length * 12),
        dominant_quote: framingQuotes.get(rid) || `${uniqueOutlets.length} outlets covering`,
        outlet_count: uniqueOutlets.length,
        key_outlets: uniqueOutlets.slice(0, 5),
      }
    })
    .sort((a, b) => {
      if (a.status === 'original') return -1
      if (b.status === 'original') return 1
      return b.outlet_count - a.outlet_count
    })

  const frameDescriptions = [
    'Story breaks',
    'Wire services pick up',
    'Regional outlets respond',
    'Global coverage spreads',
    'Counter-narratives emerge',
    'Full global picture',
  ]

  const timeline = []
  for (let i = 0; i < 6; i++) {
    // Progressive reveal: frame 0 = origin only, frame 5 = all regions
    const count = Math.max(1, Math.ceil(sortedRegions.length * (i + 1) / 6))
    const regionsInFrame = sortedRegions.slice(0, count)
    const flows = buildFlows(regionsInFrame, firstRegion)

    timeline.push({
      hour: i * 4,
      label: `${dateLabel}`,
      description: frameDescriptions[i],
      regions: regionsInFrame,
      flows,
    })
  }

  const existing = story.confidenceNote ? JSON.parse(story.confidenceNote) : {}
  existing.propagationTimeline = timeline
  await prisma.story.update({ where: { id }, data: { confidenceNote: JSON.stringify(existing) } })

  return Response.json({
    success: true,
    frames: 6,
    regions: sortedRegions.length,
    date: dateLabel,
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
