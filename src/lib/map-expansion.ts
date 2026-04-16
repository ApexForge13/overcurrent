import { expandRegionKey, isCountryKey } from './map-regions'

export type ClassificationStatus =
  | 'original'
  | 'wire_copy'
  | 'reframed'
  | 'contradicted'
  | 'no_coverage'
  | 'adjacent_coverage'
  | 'displaced'
  | 'silent'

export interface RawClassification {
  /** Hybrid key from classifier — may be country ISO2 or regional alias */
  key: string
  border: ClassificationStatus
  fill: ClassificationStatus
  summary: string
}

export interface CountryClassification {
  iso2: string
  border: ClassificationStatus
  fill: ClassificationStatus
  summary: string
  /** Which classifier key this country's data came from (for debugging) */
  source_key: string
}

/**
 * Expand raw classifier output (hybrid keys) into per-country classifications.
 *
 * Rules:
 * - Regional keys (eu, la, me, sea, af) expand to all member countries
 * - Country-level keys (hu, us, tr, de) override regional defaults
 * - Country-level always wins over regional when both classify the same country
 */
export function expandClassifications(
  raw: RawClassification[]
): Record<string, CountryClassification> {
  const out: Record<string, CountryClassification> = {}

  // Pass 1: apply regional (multi-country) classifications first
  for (const entry of raw) {
    if (isCountryKey(entry.key)) continue
    const countries = expandRegionKey(entry.key)
    if (countries.length === 0) {
      console.warn(`[map-expansion] Unknown region key: "${entry.key}" — skipping`)
      continue
    }
    for (const iso2 of countries) {
      out[iso2] = {
        iso2,
        border: entry.border,
        fill: entry.fill,
        summary: entry.summary,
        source_key: entry.key,
      }
    }
  }

  // Pass 2: apply country-level classifications (these override regional)
  for (const entry of raw) {
    if (!isCountryKey(entry.key)) continue
    const countries = expandRegionKey(entry.key)
    if (countries.length === 0) {
      console.warn(`[map-expansion] Unknown country key: "${entry.key}" — skipping`)
      continue
    }
    const iso2 = countries[0]
    out[iso2] = {
      iso2,
      border: entry.border,
      fill: entry.fill,
      summary: entry.summary,
      source_key: entry.key,
    }
  }

  const countryCount = Object.keys(out).length
  const regionKeys = raw.filter(r => !isCountryKey(r.key)).map(r => r.key)
  const countryKeys = raw.filter(r => isCountryKey(r.key)).map(r => r.key)
  console.log(`[map-expansion] ${raw.length} hybrid keys → ${countryCount} per-country classifications`)
  console.log(`[map-expansion] Regional: [${regionKeys.join(', ')}] | Country overrides: [${countryKeys.join(', ')}]`)

  return out
}

/**
 * Convert existing timeline frames from hybrid region_id keys to per-country
 * ISO2 keys. Each frame's regions array becomes a countries record.
 */
export function expandTimelineFrame(
  frame: { regions: Array<{ region_id: string; status: string; border_status?: string; coverage_volume: number; dominant_quote: string; outlet_count: number; key_outlets: string[] }>; flows?: Array<{ from: string; to: string; type: string }> },
): Record<string, CountryClassification> {
  const raw: RawClassification[] = frame.regions.map(r => ({
    key: r.region_id,
    border: (r.border_status ?? r.status) as ClassificationStatus,
    fill: r.status as ClassificationStatus,
    summary: r.dominant_quote || '',
  }))
  return expandClassifications(raw)
}
