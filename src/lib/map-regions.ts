/**
 * Mapping from hybrid region IDs (used by the classifier and synthesis)
 * to the ISO alpha-2 country codes they expand into.
 *
 * The classifier/synthesis outputs these hybrid keys; the pipeline expands
 * them before storage so the renderer only sees flat per-country data.
 */

export const REGION_EXPANSIONS: Record<string, string[]> = {
  // ── European Union + broader Europe ──
  eu: [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    // Non-EU European states included because classifier uses 'eu' broadly
    'CH', 'NO', 'IS', 'UA', 'BY', 'MD', 'RS', 'BA', 'AL', 'MK', 'ME', 'XK',
  ],

  // ── UK / Ireland ──
  uk: ['GB', 'IE'],

  // ── Middle East ──
  me: ['SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'YE', 'IQ', 'JO', 'LB', 'SY', 'PS', 'EG'],

  // ── Africa ──
  // NOTE: key is 'africa' not 'af' — 'af' is reserved for Afghanistan ISO2
  africa: [
    'EG', 'LY', 'TN', 'DZ', 'MA', 'SD', 'SS', 'ET', 'KE', 'UG', 'TZ', 'RW',
    'NG', 'GH', 'SN', 'ML', 'CI', 'CM', 'AO', 'ZM', 'ZW', 'MZ', 'ZA',
    'NA', 'BW', 'MG', 'SO', 'CD', 'CG', 'BF', 'NE', 'TD', 'ER', 'DJ',
    'MW', 'LS', 'SZ', 'GA', 'GQ', 'CF', 'BI', 'TG', 'BJ', 'SL', 'LR', 'GW', 'GM',
  ],

  // ── Latin America ──
  la: [
    'MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA',
    'CO', 'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR', 'GY', 'SR',
    'CU', 'DO', 'HT', 'JM', 'TT', 'BB', 'BS',
  ],

  // ── Southeast Asia ──
  sea: ['TH', 'VN', 'ID', 'PH', 'MY', 'SG', 'MM', 'KH', 'LA', 'BN', 'TL'],

  // ── South & Central Asia ──
  'in': ['IN', 'BD', 'LK', 'NP', 'BT', 'MV'],
  sa: ['IN', 'BD', 'LK', 'NP', 'BT', 'MV', 'AF', 'PK'],

  // ── Central Asia ──
  ca: ['KZ', 'UZ', 'KG', 'TJ', 'TM'],

  // ── East Asia ──
  cn: ['CN', 'HK', 'TW'],

  // ── Oceania ──
  au: ['AU', 'NZ', 'PG', 'FJ'],

  // ── Single-country aliases ──
  // Classifier may emit ISO2 lowercase or a known alias
  us: ['US'],
  mx: ['MX'],
  gb: ['GB'],
  ru: ['RU'],
  jp: ['JP'],
  kr: ['KR'],
  pk: ['PK'],
  ir: ['IR'],
  il: ['IL'],
  tr: ['TR'],
  hu: ['HU'],
  de: ['DE'],
  fr: ['FR'],
  it: ['IT'],
  es: ['ES'],
  br: ['BR'],
  ar: ['AR'],
  za: ['ZA'],
  eg: ['EG'],
  ua: ['UA'],
  pl: ['PL'],
  nl: ['NL'],
  se: ['SE'],
  no: ['NO'],
  dk: ['DK'],
  fi: ['FI'],
  at: ['AT'],
  ch: ['CH'],
  be: ['BE'],
  pt: ['PT'],
  ie: ['IE'],
  ro: ['RO'],
  cz: ['CZ'],
  gr: ['GR'],
  ng: ['NG'],
  ke: ['KE'],
  gh: ['GH'],
  et: ['ET'],
  tz: ['TZ'],
  ug: ['UG'],
  co: ['CO'],
  cl: ['CL'],
  pe: ['PE'],
  ve: ['VE'],
  ec: ['EC'],
  th: ['TH'],
  vn: ['VN'],
  ph: ['PH'],
  my: ['MY'],
  sg: ['SG'],
  id: ['ID'],
  mm: ['MM'],
  kh: ['KH'],
  bd: ['BD'],
  lk: ['LK'],
  np: ['NP'],
  // 'af' is ambiguous: classifier may mean Africa (region) or Afghanistan (ISO2).
  // We resolve by checking context: if the timeline has 'af' with outlet_count > 1
  // or coverage_volume > 10, it's probably Africa. For the expansion table, we
  // map 'af' to the Africa expansion (the more common usage in classifier output).
  af: [
    'EG', 'LY', 'TN', 'DZ', 'MA', 'SD', 'SS', 'ET', 'KE', 'UG', 'TZ', 'RW',
    'NG', 'GH', 'SN', 'ML', 'CI', 'CM', 'AO', 'ZM', 'ZW', 'MZ', 'ZA',
    'NA', 'BW', 'MG', 'SO', 'CD', 'CG', 'BF', 'NE', 'TD', 'ER', 'DJ',
    'MW', 'LS', 'SZ', 'GA', 'GQ', 'CF', 'BI', 'TG', 'BJ', 'SL', 'LR', 'GW', 'GM',
  ],
  iq: ['IQ'],
  sy: ['SY'],
  lb: ['LB'],
  jo: ['JO'],
  sa_country: ['SA'],
  ae: ['AE'],
  qa: ['QA'],
  kw: ['KW'],
  bh: ['BH'],
  om: ['OM'],
  ye: ['YE'],
  tw: ['TW'],
  hk: ['HK'],
  nz: ['NZ'],
}

/**
 * Given a hybrid key from the classifier, return the list of ISO2 country
 * codes it expands to. Falls back to treating the key as an ISO2 code itself.
 */
export function expandRegionKey(key: string): string[] {
  const normalized = key.trim().toLowerCase()
  // Check expansion table first
  if (REGION_EXPANSIONS[normalized]) {
    return REGION_EXPANSIONS[normalized]
  }
  // If key is 2 chars, treat as ISO2 directly
  if (normalized.length === 2) {
    return [normalized.toUpperCase()]
  }
  return []
}

/**
 * Check whether a hybrid key refers to a single country.
 * Country-level keys override regional keys when both classify the same country.
 */
export function isCountryKey(key: string): boolean {
  const expansion = expandRegionKey(key)
  return expansion.length === 1
}
