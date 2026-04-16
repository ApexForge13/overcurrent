import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { JSON_RULES } from './prompts'
import { normalizeCountryCode } from '@/lib/country-codes'

export interface CountryClassification {
  country_code: string
  region_id: string
  outlet_count: number
  outlets: string[]
  border_status: 'original' | 'wire_copy' | 'reframed' | 'no_coverage'
  fill_status: 'original' | 'wire_copy' | 'reframed' | 'contradicted' | 'no_coverage' | 'adjacent_coverage' | 'displaced_coverage'
  dominant_framing: string
}

const SYSTEM_PROMPT = `You are a map classification agent for Overcurrent, a news verification platform. You receive the complete analysis output for a story and must classify every country/region that has sources.

For each country, you determine TWO separate statuses:

BORDER STATUS (how the country RECEIVED the story):
- "original": The event physically happened in this country, OR the country is a direct government participant. Only 2-3 countries per story qualify.
- "wire_copy": The country's outlets received the story via AP, Reuters, AFP wire services. Most international coverage is wire copy.
- "reframed": The country's outlets did significant original reporting — own correspondents, exclusive interviews, analysis beyond wire content.
- "no_coverage": No outlets from this region covered the story at all. Use this for regions listed in REGIONS WITHOUT SOURCES below.

FILL STATUS (how the country REPORTED the story relative to consensus):
- "original": Coverage aligns with moderator consensus. Core facts reported without significant editorial reframing.
- "wire_copy": Same as original but explicitly wire-sourced.
- "reframed": Outlets emphasized different aspects, added unique regional angles, or applied distinct editorial framing. Examples: India focusing on regional rivalry, Israel focusing on security.
- "contradicted": Outlets directly contradicted a moderator consensus claim OR presented an opposing narrative as the PRIMARY frame. Quoting the other side is NOT contradiction — leading with the other side's narrative AS the primary frame IS.
- "no_coverage": No outlets from this region covered the story. The story did not propagate here.
- "adjacent_coverage": Region covered a RELATED topic (e.g., same geographic area, same policy domain) but NOT the specific story. Almost-coverage.
- "displaced_coverage": Region's outlets were covering a DIFFERENT major story instead, explaining why this story was crowded out.

IMPORTANT DISTINCTIONS:
- Balanced reporting that quotes both sides = wire_copy or original fill (NOT contradicted)
- Adding a unique regional angle while reporting consensus facts = reframed fill
- Leading with a counter-narrative as the headline/primary frame = contradicted fill
- State media (RT, CGTN, PressTV) that reframe stories through their government's lens = reframed border, often contradicted fill
- Regions with ZERO sources must still be classified — use no_coverage, adjacent_coverage, or displaced_coverage

dominant_framing should be a SHORT quote (under 15 words) summarizing how this country's outlets framed the story. Use the actual framing from the analysis, not generic descriptions.

CLASSIFICATION RULES:
- Each entry must have a UNIQUE region_id. Do NOT create multiple entries for the same region_id with different framings.
- If a region has multiple outlets with different framings, pick the DOMINANT framing (from the highest-reliability outlet or the majority framing).
- For European countries: use the specific country region_id when the country has its own ID in the mapping (uk, ru, tr). Other European countries map to "eu" — create ONE "eu" entry with the dominant European framing.
- "eu" covers: France, Germany, Italy, Spain, Netherlands, Sweden, Norway, Belgium, Switzerland, Czech Republic, Denmark, Finland, Greece, Hungary, Poland, Portugal, Ukraine.
- DO NOT create 6 separate "eu" entries. One entry for "eu" with the combined outlet count and dominant framing.

${JSON_RULES}

Output format:
{
  "classifications": [
    {
      "country_code": "US",
      "region_id": "us",
      "outlet_count": 21,
      "outlets": ["Fox News", "NPR", "CBS News"],
      "border_status": "original",
      "fill_status": "original",
      "dominant_framing": "Iran refused nuclear commitments"
    }
  ]
}

CRITICAL: Return ONLY valid JSON. No explanatory text. No markdown fences.`

/** Map country code to globe region ID */
export function countryToRegionId(country: string): string {
  const map: Record<string, string> = {
    US: 'us', CA: 'ca', MX: 'mx', GB: 'uk', IE: 'uk',
    FR: 'eu', DE: 'eu', IT: 'eu', ES: 'eu', NL: 'eu', SE: 'eu', NO: 'eu', BE: 'eu',
    CH: 'eu', CZ: 'eu', DK: 'eu', FI: 'eu', GR: 'eu', HU: 'eu', PL: 'eu', PT: 'eu', UA: 'eu',
    AT: 'eu', LU: 'eu', MT: 'eu', CY: 'eu', IS: 'eu', SK: 'eu', SI: 'eu', HR: 'eu',
    RS: 'eu', BA: 'eu', ME: 'eu', MK: 'eu', AL: 'eu', XK: 'eu', MD: 'eu', BY: 'eu',
    LT: 'eu', LV: 'eu', EE: 'eu', RO: 'eu', BG: 'eu', GE: 'eu', AM: 'eu', AZ: 'eu',
    RU: 'ru', TR: 'tr', IR: 'ir', IL: 'il',
    SA: 'me', QA: 'me', AE: 'me', EG: 'me', JO: 'me', LB: 'me', IQ: 'me', SY: 'me',
    KW: 'me', BH: 'me', OM: 'me', YE: 'me', PS: 'me',
    KE: 'af', ZA: 'af', NG: 'af', GH: 'af', ET: 'af', TZ: 'af', UG: 'af',
    CM: 'af', SN: 'af', RW: 'af', ZW: 'af', ZM: 'af', MZ: 'af', SD: 'af',
    LY: 'af', TN: 'af', DZ: 'af', MA: 'af', SO: 'af', ML: 'af',
    IN: 'in', PK: 'pk', BD: 'in', LK: 'in', NP: 'in', AF: 'in', MV: 'in',
    KZ: 'in', KG: 'in', UZ: 'in', TJ: 'in', TM: 'in',
    CN: 'cn', JP: 'jp', KR: 'kr', HK: 'cn', TW: 'cn', MN: 'cn',
    SG: 'sea', TH: 'sea', ID: 'sea', MY: 'sea', PH: 'sea', VN: 'sea', MM: 'sea',
    KH: 'sea', LA: 'sea', BN: 'sea',
    AU: 'au', NZ: 'au', FJ: 'au', PG: 'au',
    BR: 'la', AR: 'la', CO: 'la', CL: 'la', PE: 'la', VE: 'la', UY: 'la',
    EC: 'la', BO: 'la', PY: 'la', PA: 'la', CR: 'la', GT: 'la', HN: 'la',
    SV: 'la', NI: 'la', CU: 'la', DO: 'la', JM: 'la', TT: 'la', PR: 'la', BB: 'la',
  }
  // Normalize: handle full country names, lowercase codes, etc.
  const upper = country?.toUpperCase().trim()
  if (upper && map[upper]) return map[upper]

  // Try normalizing full country name → ISO code
  const normalized = normalizeCountryCode(country)
  if (normalized && map[normalized]) return map[normalized]

  return 'us'
}

export async function classifyMapRegions(
  story: {
    headline: string
    synopsis: string | null
    sources: Array<{ outlet: string; country: string; region: string; politicalLean: string }>
    framings: Array<{ region: string; framing: string; contrastWith: string | null }>
    discrepancies: Array<{ issue: string; sideA: string; sideB: string; sourcesA: string; sourcesB: string; assessment: string | null }>
    claims: Array<{ claim: string; confidence: string; supportedBy: string; contradictedBy: string }>
  },
  storyId?: string,
): Promise<{ classifications: CountryClassification[]; costUsd: number }> {
  // Group sources by region_id
  const byRegion = new Map<string, { outlets: Set<string>; countries: Set<string>; leans: Set<string> }>()
  for (const s of story.sources) {
    const rid = countryToRegionId(s.country)
    if (!byRegion.has(rid)) byRegion.set(rid, { outlets: new Set(), countries: new Set(), leans: new Set() })
    const r = byRegion.get(rid)!
    r.outlets.add(s.outlet)
    r.countries.add(s.country)
    r.leans.add(s.politicalLean)
  }

  const regionSummary = Array.from(byRegion.entries()).map(([rid, data]) => ({
    region_id: rid,
    outlet_count: data.outlets.size,
    outlets: [...data.outlets],
    countries: [...data.countries],
    has_state_media: data.leans.has('state-controlled'),
  }))

  // Find regions WITHOUT sources for no_coverage/adjacent/displaced classification
  const ALL_REGION_IDS = ['us', 'ca', 'mx', 'uk', 'eu', 'ru', 'tr', 'ir', 'il', 'me', 'af', 'in', 'pk', 'cn', 'jp', 'kr', 'sea', 'au', 'la']
  const coveredRegions = new Set(regionSummary.map(r => r.region_id))
  const uncoveredRegions = ALL_REGION_IDS.filter(r => !coveredRegions.has(r))

  // Pre-compute classification hints from data
  const stateMediaRegions = regionSummary
    .filter(r => r.has_state_media)
    .map(r => r.region_id)

  const regionsWithContrast = story.framings
    .filter(f => f.contrastWith && f.contrastWith.trim().length > 10)
    .map(f => f.region)

  const regionsInDiscrepancies = new Set<string>()
  for (const d of story.discrepancies) {
    // Regions mentioned in side B (dissenting) are likely reframed or contradicted
    const allSources = `${d.sourcesA} ${d.sourcesB}`.toLowerCase()
    for (const r of regionSummary) {
      for (const outlet of r.outlets) {
        if (allSources.includes(outlet.toLowerCase())) {
          regionsInDiscrepancies.add(r.region_id)
        }
      }
    }
  }

  // ── BATCH CLASSIFICATION: 5 regions per call for more attention per region ──
  const allRegionIds = [...new Set([...regionSummary.map(r => r.region_id), ...uncoveredRegions])]
  const BATCH_SIZE = 5
  const allClassifications: CountryClassification[] = []
  let totalCost = 0

  // Context shared across all batches
  const sharedContext = `STORY: ${story.headline}
Synopsis: ${story.synopsis || 'N/A'}

REGIONAL FRAMINGS FROM SYNTHESIS:
${JSON.stringify(story.framings.map(f => ({ region: f.region, framing: f.framing, contrast: f.contrastWith })), null, 2)}

DISCREPANCIES FOUND:
${JSON.stringify(story.discrepancies.map(d => ({ issue: d.issue, sideA: d.sideA, sideB: d.sideB, sourcesA: d.sourcesA, sourcesB: d.sourcesB })), null, 2)}

KEY CLAIMS:
${JSON.stringify(story.claims.slice(0, 8).map(c => ({ claim: c.claim, confidence: c.confidence, supportedBy: c.supportedBy, contradictedBy: c.contradictedBy })), null, 2)}`

  for (let i = 0; i < allRegionIds.length; i += BATCH_SIZE) {
    const batchRegionIds = allRegionIds.slice(i, i + BATCH_SIZE)
    const batchRegions = regionSummary.filter(r => batchRegionIds.includes(r.region_id))
    const batchUncovered = batchRegionIds.filter(r => uncoveredRegions.includes(r))

    const batchHints: string[] = []
    for (const rid of batchRegionIds) {
      if (stateMediaRegions.includes(rid)) batchHints.push(`${rid}: HAS STATE MEDIA — must be "reframed" or "contradicted", NEVER "wire_copy"`)
      if (regionsWithContrast.some(r => r.toLowerCase().includes(rid))) batchHints.push(`${rid}: HAS CONTRASTING FRAMING — classify as "reframed"`)
      if (regionsInDiscrepancies.has(rid)) batchHints.push(`${rid}: INVOLVED IN DISCREPANCY — likely "reframed" or "contradicted"`)
    }

    const batchPrompt = `${sharedContext}

CLASSIFY THESE ${batchRegionIds.length} REGIONS:
${JSON.stringify(batchRegions, null, 2)}

${batchUncovered.length > 0 ? `REGIONS WITHOUT SOURCES (use no_coverage/adjacent_coverage/displaced_coverage): ${JSON.stringify(batchUncovered)}` : ''}

${batchHints.length > 0 ? `MANDATORY HINTS:\n${batchHints.join('\n')}` : ''}

RULES:
- wire_copy = outlet ran AP/Reuters/AFP text VERBATIM. No editorial additions whatsoever.
- reframed = outlet added its own headline, commentary, regional angle, or editorial context. This is MOST outlets.
- contradicted = outlet's primary frame OPPOSES the consensus. Not just quoting the other side — LEADING with a counter-narrative.
- original = the story originated here. Only 1-2 regions qualify.
- If an outlet added ANY editorial framing beyond wire text, classify as "reframed", not "wire_copy".

Respond with JSON: { "classifications": [...] }`

    try {
      const result = await callClaude({
        model: HAIKU,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: batchPrompt,
        agentType: 'map-classifier',
        maxTokens: 2048,
        storyId,
      })
      totalCost += result.costUsd

      const parsed = parseJSON<{ classifications: CountryClassification[] }>(result.text)
      if (parsed.classifications) {
        for (const c of parsed.classifications) {
          allClassifications.push({
            country_code: String(c.country_code ?? ''),
            region_id: String(c.region_id ?? ''),
            outlet_count: Number(c.outlet_count ?? 0),
            outlets: Array.isArray(c.outlets) ? c.outlets.map(String) : [],
            border_status: (['original', 'wire_copy', 'reframed', 'no_coverage'].includes(c.border_status) ? c.border_status : 'reframed') as CountryClassification['border_status'],
            fill_status: (['original', 'wire_copy', 'reframed', 'contradicted', 'no_coverage', 'adjacent_coverage', 'displaced_coverage'].includes(c.fill_status) ? c.fill_status : 'reframed') as CountryClassification['fill_status'],
            dominant_framing: String(c.dominant_framing ?? ''),
          })
        }
        console.log(`[map] Batch ${Math.floor(i/BATCH_SIZE)+1}: classified ${parsed.classifications.length} regions`)
      }
    } catch (err) {
      console.warn(`[map] Batch ${Math.floor(i/BATCH_SIZE)+1} failed:`, err instanceof Error ? err.message : err)
      // Add uncovered defaults for failed batch
      for (const rid of batchRegionIds) {
        allClassifications.push({
          country_code: rid.toUpperCase(),
          region_id: rid,
          outlet_count: 0,
          outlets: [],
          border_status: 'no_coverage',
          fill_status: 'no_coverage',
          dominant_framing: 'Classification failed',
        })
      }
    }
  }

  // Deduplicate by region_id (keep first)
  const seen = new Set<string>()
  const deduped = allClassifications.filter(c => {
    if (seen.has(c.region_id)) return false
    seen.add(c.region_id)
    return true
  })

  return { classifications: deduped, costUsd: totalCost }
}
