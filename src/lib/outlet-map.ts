/**
 * Pure mapping function from the in-code OutletInfo registry (src/data/outlets.ts)
 * to the canonical Outlet DB row shape.
 *
 * The ingestion pipeline uses OutletInfo (Title-Case regions, medium types:
 * newspaper/broadcaster/digital). The signal layer uses Outlet (snake_case
 * regions, editorial types: mainstream/independent/state/wire/aggregator).
 *
 * This function is the single boundary between those two vocabularies.
 */

import type { OutletInfo } from '@/data/outlets'
import { MUST_HAVE_DOMAINS, HIGH_PRIORITY_DOMAINS } from '@/data/outlets'

// ── Region mapping ──────────────────────────────────────────────────
// OutletInfo uses 6 Title-Case regions. Outlet DB uses 7 snake_case regions
// (including "global" for wire services / state media without regional anchor).
const REGION_MAP: Record<string, string> = {
  'North America': 'north_america',
  'Europe': 'europe',
  'Asia-Pacific': 'asia_pacific',
  'Middle East & Africa': 'middle_east',
  'South & Central Asia': 'asia_pacific', // merge into asia_pacific for signal layer
  'Latin America': 'latin_america',
}

/** Map Title-Case region name → snake_case signal-layer region. */
export function mapRegion(region: string): string {
  return REGION_MAP[region] ?? 'global'
}

// ── Editorial type mapping ──────────────────────────────────────────
// OutletInfo.type is about medium. Outlet.editorialType is about positioning.
// Mapping is rule-based:
//   - type='wire' → 'wire'
//   - type='state' → 'state'
//   - reliability='low' + lean='state-controlled' → 'state' (catches state-funded)
//   - aggregator domains (allafrica, africanews) → 'aggregator'
//   - narrow-topic high-reliability digital → 'independent' (if we detect it)
//   - all others → 'mainstream'
const AGGREGATOR_DOMAINS = new Set([
  'allafrica.com',
  'africanews.com',
  'news.google.com',
])

// Outlets with narrow topical focus regardless of type. Human-curated.
const KNOWN_INDEPENDENT_DOMAINS = new Set([
  'theintercept.com',
  'propublica.org',
  'meduza.io',
  'kyivindependent.com',
  'caixinglobal.com',
  'sixthtone.com',
  'madamasr.com',
  'iranintl.com',
  'iranwire.com',
  'radiofarda.com',
  'dailymaverick.co.za',
  'mg.co.za',
  'premiumtimesng.com',
  'addisstandard.com',
  'efectococuyo.com',
  'elespectador.com',
  'rappler.com',
  'malaysiakini.com',
  'middleeasteye.net',
  'al-monitor.com',
  'rferl.org',
  'rfa.org',
  'thewire.in',
])

/** Map OutletInfo.type + reliability/lean → Outlet.editorialType. */
export function mapEditorialType(info: OutletInfo): string {
  const domain = normalizeDomain(info.domain)
  if (AGGREGATOR_DOMAINS.has(domain)) return 'aggregator'
  if (info.type === 'wire') return 'wire'
  if (info.type === 'state') return 'state'
  if (info.politicalLean === 'state-controlled') return 'state'
  if (KNOWN_INDEPENDENT_DOMAINS.has(domain)) return 'independent'
  // newspaper, broadcaster, digital → mainstream (default)
  return 'mainstream'
}

// ── Tier pre-seed logic ────────────────────────────────────────────
// Six tiers: wire_service | national | regional | specialty | emerging | unclassified
//
// Pre-seed heuristic:
// 1. wire_service: type='wire' OR domain in wire set
// 2. national: MUST-HAVE + country in G7/major markets (US/UK/DE/FR/CN/JP/CA/IT/AU)
// 3. emerging: broad-coverage independent in markets with limited press freedom
// 4. specialty: narrow topical focus (defense, policy, think tanks)
// 5. regional: non-wire, non-G7, priority list or broad regional coverage
// 6. unclassified: everything else (default)

const NATIONAL_COUNTRIES = new Set([
  'US', 'GB', 'DE', 'FR', 'JP', 'CA', 'IT', 'AU', 'CN',
])

// Manually-curated "national" tier overrides for outlets that are papers of
// record in their country regardless of G7 status or whether they're on the
// MUST-HAVE list. These punch above their weight in global coverage.
// Reviewed by admin; can add/remove without touching the heuristic.
const NATIONAL_OVERRIDE_DOMAINS = new Set([
  'elpais.com',          // Spain — paper of record for Spanish-language global coverage
  'theglobeandmail.com', // Canada — G7 national daily
  'asahi.com',           // Japan — G7 national daily (Asahi Shimbun)
])

const EMERGING_DOMAINS = new Set([
  // Broad-coverage independents from under-covered markets or strategically
  // important angles that wire services systematically under-cover.
  'meduza.io',           // Russia diaspora
  'caixinglobal.com',    // China independent
  'madamasr.com',        // Egypt
  'efectococuyo.com',    // Venezuela — FLAG: re-evaluate reach at month 3
  'iranwire.com',        // Iran exile
  'radiofarda.com',      // Iran exile
  'kyivindependent.com', // Ukraine conflict
  'addisstandard.com',   // Horn of Africa
  'rappler.com',         // Philippines (heavily suppressed)
  'malaysiakini.com',    // Malaysia
  'thewire.in',          // India (harassed by state)
  // ── Session 1 additions ──
  'balkaninsight.com',   // Balkans + Eastern Europe — wire services under-treat
  'theconversation.com', // Academic-sourced journalism — under-covered regions
  'nikkei.com',          // Japanese business coverage of Asia — often ahead of Western wires
])

const SPECIALTY_DOMAINS = new Set([
  // Narrow topical focus — think tanks, policy, defense
  'al-monitor.com',           // Middle East analysis
  'defenseone.com',           // Defense policy
  'responsiblestatecraft.org',// Foreign policy
  'cepa.org',                 // Transatlantic policy
  'globsec.org',              // Security policy
  'americanprogress.org',     // Progressive policy
  'csis.org',                 // Strategic studies
  'foreignpolicy.com',        // Foreign policy
  'economist.com',            // Economics focus (borderline, but editorially narrow)
  'politico.com',             // Politics focus
  'politico.eu',              // Politics focus
  'bloomberg.com',            // Financial/markets focus
  'ft.com',                   // Financial focus
  'frontline.thehindu.com',   // Long-form investigative
  'balkaninsight.com',        // Balkans investigative
  'eurasiareview.com',        // Eurasia analysis
])

/** Assign initial tier based on pre-seed heuristics. Admin can override.
 *
 * Check order matters:
 *   1. wire_service  — highest signal priority
 *   2. emerging      — captured by explicit domain list
 *   3. specialty     — narrow topical focus (checked before national to catch FT/Economist)
 *   4. national      — NATIONAL_OVERRIDE first (manual curation), then MUST-HAVE heuristic
 *   5. regional      — HIGH_PRIORITY or high-reliability non-G7 mainstream
 *   6. unclassified  — everything else
 */
export function mapTier(info: OutletInfo): string {
  const domain = normalizeDomain(info.domain)

  // Wire services — always highest priority
  if (info.type === 'wire') return 'wire_service'

  // Emerging: broad-coverage independent from under-covered markets
  if (EMERGING_DOMAINS.has(domain)) return 'emerging'

  // Specialty: narrow topical focus
  if (SPECIALTY_DOMAINS.has(domain)) return 'specialty'

  // National override: manually curated papers-of-record that punch above weight
  if (NATIONAL_OVERRIDE_DOMAINS.has(domain)) return 'national'

  // National: MUST-HAVE from G7/major markets
  if (MUST_HAVE_DOMAINS.has(domain) && NATIONAL_COUNTRIES.has(info.country)) {
    return 'national'
  }

  // Also national: MUST-HAVE major broadcasters/papers regardless of country
  // (catches BBC/Al Jazeera/NHK/etc. that might not be in G7 set)
  if (MUST_HAVE_DOMAINS.has(domain)) return 'national'

  // Regional: HIGH priority with specific country coverage
  if (HIGH_PRIORITY_DOMAINS.has(domain)) return 'regional'

  // Regional: high-reliability mainstream/state from smaller markets
  if (
    (info.type === 'newspaper' || info.type === 'broadcaster' || info.type === 'state') &&
    info.reliability === 'high' &&
    !NATIONAL_COUNTRIES.has(info.country)
  ) {
    return 'regional'
  }

  // Default
  return 'unclassified'
}

/** Normalize a domain (strip www., lowercase, strip protocol/path). */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
}

// ── Main mapping ───────────────────────────────────────────────────

export interface OutletDbRow {
  domain: string
  name: string
  country: string
  region: string
  editorialType: string
  politicalLean: string
  reliability: string
  language: string
  tier: string
  priority: string | null
}

/** Convert an OutletInfo → Outlet DB row shape. Pure function. */
export function mapOutlet(info: OutletInfo): OutletDbRow {
  return {
    domain: normalizeDomain(info.domain),
    name: info.name,
    country: info.country,
    region: mapRegion(info.region),
    editorialType: mapEditorialType(info),
    politicalLean: info.politicalLean,
    reliability: info.reliability,
    language: info.language || 'en',
    tier: mapTier(info),
    priority: info.priority ?? null,
  }
}
