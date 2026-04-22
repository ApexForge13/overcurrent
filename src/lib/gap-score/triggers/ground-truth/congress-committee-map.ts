/**
 * Congressional committee → sector jurisdiction map.
 *
 * Used by T-GT10 to apply the elevation rule "member on committee with
 * sector jurisdiction over issuer". Match is fuzzy (committee substring
 * match) because disclosure data often lists partial or informal names.
 *
 * Sectors use the TrackedEntity.subcategory values where applicable, with
 * a few generic buckets (healthcare, defense, energy) that span multiple
 * subcategories.
 *
 * Expansion policy: hand-maintained. Add aggressively when a new trigger
 * firing references an unmapped committee — the signal value comes from
 * depth of coverage. Admin UI Phase 1c.2b moves this to DB if needed.
 */

export type CommitteeSector =
  | 'financial_services'
  | 'healthcare'
  | 'energy'
  | 'defense'
  | 'technology'
  | 'agriculture'
  | 'transportation'
  | 'telecommunications'

/**
 * Normalized lowercase committee-name-fragment → sector.
 * We match by substring of the committee name so "Committee on Energy and
 * Commerce" matches both 'energy' and 'healthcare' (it covers both).
 */
export const COMMITTEE_SECTOR_MAP: Array<{
  pattern: string
  sectors: CommitteeSector[]
}> = [
  // House committees
  { pattern: 'financial services', sectors: ['financial_services'] },
  { pattern: 'energy and commerce', sectors: ['energy', 'healthcare', 'telecommunications'] },
  { pattern: 'armed services', sectors: ['defense'] },
  { pattern: 'agriculture', sectors: ['agriculture'] },
  { pattern: 'transportation and infrastructure', sectors: ['transportation'] },
  { pattern: 'science, space, and technology', sectors: ['technology'] },
  { pattern: 'natural resources', sectors: ['energy'] },
  { pattern: 'veterans', sectors: ['healthcare'] },
  { pattern: 'appropriations', sectors: ['defense', 'healthcare', 'energy', 'transportation'] },
  { pattern: 'ways and means', sectors: ['healthcare', 'financial_services'] },
  // Senate committees
  { pattern: 'banking, housing, and urban affairs', sectors: ['financial_services'] },
  { pattern: 'commerce, science, and transportation', sectors: ['technology', 'transportation', 'telecommunications'] },
  { pattern: 'health, education, labor', sectors: ['healthcare'] },
  { pattern: 'energy and natural resources', sectors: ['energy'] },
  { pattern: 'foreign relations', sectors: ['defense'] },
  { pattern: 'finance', sectors: ['financial_services', 'healthcare'] },
  { pattern: 'intelligence', sectors: ['defense', 'technology'] },
]

/**
 * Given a lower-cased committee name, return matching sectors (empty if no
 * substring matches).
 */
export function committeesToSectors(committeeNames: string[]): CommitteeSector[] {
  const sectors = new Set<CommitteeSector>()
  for (const name of committeeNames) {
    const lower = name.toLowerCase()
    for (const row of COMMITTEE_SECTOR_MAP) {
      if (lower.includes(row.pattern)) {
        for (const s of row.sectors) sectors.add(s)
      }
    }
  }
  return Array.from(sectors)
}

/**
 * Is this TrackedEntity subcategory covered by any of these sectors?
 * Intentionally permissive — "banks" / "bank" / "financial_services" all
 * count as financial_services.
 */
export function subcategoryMatchesSector(
  subcategory: string | null | undefined,
  sectors: CommitteeSector[],
): boolean {
  if (!subcategory) return false
  const lower = subcategory.toLowerCase()
  for (const s of sectors) {
    if (s === 'financial_services' && (lower.includes('bank') || lower.includes('financial') || lower.includes('insurance'))) return true
    if (s === 'healthcare' && (lower.includes('health') || lower.includes('pharma') || lower.includes('biotech') || lower.includes('medical'))) return true
    if (s === 'energy' && (lower.includes('energy') || lower.includes('oil') || lower.includes('gas') || lower.includes('utility'))) return true
    if (s === 'defense' && (lower.includes('defense') || lower.includes('aerospace') || lower.includes('military'))) return true
    if (s === 'technology' && (lower.includes('tech') || lower.includes('software') || lower.includes('semiconductor'))) return true
    if (s === 'agriculture' && (lower.includes('agri') || lower.includes('food') || lower.includes('grains') || lower.includes('livestock'))) return true
    if (s === 'transportation' && (lower.includes('transport') || lower.includes('auto') || lower.includes('airline') || lower.includes('rail'))) return true
    if (s === 'telecommunications' && (lower.includes('telecom') || lower.includes('media'))) return true
  }
  return false
}
