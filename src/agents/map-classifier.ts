import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'
import { JSON_RULES } from './prompts'

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

  const userPrompt = `STORY: ${story.headline}
Synopsis: ${story.synopsis || 'N/A'}

SOURCES BY REGION (${regionSummary.length} regions, ${story.sources.length} total sources):
${JSON.stringify(regionSummary, null, 2)}

REGIONS WITHOUT SOURCES (classify as no_coverage, adjacent_coverage, or displaced_coverage):
${JSON.stringify(uncoveredRegions)}

REGIONAL FRAMINGS FROM SYNTHESIS:
${JSON.stringify(story.framings.map(f => ({ region: f.region, framing: f.framing, contrast: f.contrastWith })), null, 2)}

DISCREPANCIES FOUND:
${JSON.stringify(story.discrepancies.map(d => ({ issue: d.issue, sideA: d.sideA, sideB: d.sideB, sourcesA: d.sourcesA, sourcesB: d.sourcesB })), null, 2)}

KEY CLAIMS:
${JSON.stringify(story.claims.slice(0, 8).map(c => ({ claim: c.claim, confidence: c.confidence, supportedBy: c.supportedBy, contradictedBy: c.contradictedBy })), null, 2)}

Classify EVERY region — both those WITH sources and those WITHOUT. For regions without sources, use border_status="no_coverage" and fill_status as no_coverage, adjacent_coverage, or displaced_coverage. Set outlet_count=0 and outlets=[] for uncovered regions.`

  const result = await callClaude({
    model: HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'map-classifier',
    maxTokens: 4096,
    storyId,
  })

  const parsed = parseJSON<{ classifications: CountryClassification[] }>(result.text)

  return {
    classifications: (parsed.classifications ?? []).map(c => ({
      country_code: String(c.country_code ?? ''),
      region_id: String(c.region_id ?? ''),
      outlet_count: Number(c.outlet_count ?? 0),
      outlets: Array.isArray(c.outlets) ? c.outlets.map(String) : [],
      border_status: (['original', 'wire_copy', 'reframed', 'no_coverage'].includes(c.border_status) ? c.border_status : 'wire_copy') as CountryClassification['border_status'],
      fill_status: (['original', 'wire_copy', 'reframed', 'contradicted', 'no_coverage', 'adjacent_coverage', 'displaced_coverage'].includes(c.fill_status) ? c.fill_status : 'wire_copy') as CountryClassification['fill_status'],
      dominant_framing: String(c.dominant_framing ?? ''),
    })),
    costUsd: result.costUsd,
  }
}
