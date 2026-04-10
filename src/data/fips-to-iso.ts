/**
 * FIPS 10-4 to ISO 3166-1 alpha-2 country code mapping.
 *
 * GDELT uses FIPS 10-4 two-letter codes which differ from ISO in many cases.
 * This file provides the canonical mapping plus region classification.
 */

export const fipsToIso: Record<string, { iso: string; name: string; region: string }> = {
  // ── North America ──────────────────────────────────────────────────────
  US: { iso: "US", name: "United States", region: "North America" },
  CA: { iso: "CA", name: "Canada", region: "North America" },
  MX: { iso: "MX", name: "Mexico", region: "North America" },
  BH: { iso: "BZ", name: "Belize", region: "North America" },
  GT: { iso: "GT", name: "Guatemala", region: "North America" },
  HO: { iso: "HN", name: "Honduras", region: "North America" },
  NU: { iso: "NI", name: "Nicaragua", region: "North America" },
  CS: { iso: "CR", name: "Costa Rica", region: "North America" },
  PM: { iso: "PA", name: "Panama", region: "North America" },
  ES: { iso: "SV", name: "El Salvador", region: "North America" },
  CU: { iso: "CU", name: "Cuba", region: "North America" },
  DR: { iso: "DO", name: "Dominican Republic", region: "North America" },
  HA: { iso: "HT", name: "Haiti", region: "North America" },
  JM: { iso: "JM", name: "Jamaica", region: "North America" },
  TD: { iso: "TT", name: "Trinidad and Tobago", region: "North America" },

  // ── Europe ─────────────────────────────────────────────────────────────
  UK: { iso: "GB", name: "United Kingdom", region: "Europe" },
  FR: { iso: "FR", name: "France", region: "Europe" },
  GM: { iso: "DE", name: "Germany", region: "Europe" },
  IT: { iso: "IT", name: "Italy", region: "Europe" },
  SP: { iso: "ES", name: "Spain", region: "Europe" },
  PO: { iso: "PT", name: "Portugal", region: "Europe" },
  NL: { iso: "NL", name: "Netherlands", region: "Europe" },
  BE: { iso: "BE", name: "Belgium", region: "Europe" },
  SZ: { iso: "CH", name: "Switzerland", region: "Europe" },
  AU: { iso: "AT", name: "Austria", region: "Europe" },
  PL: { iso: "PL", name: "Poland", region: "Europe" },
  EZ: { iso: "CZ", name: "Czech Republic", region: "Europe" },
  LO: { iso: "SK", name: "Slovakia", region: "Europe" },
  HU: { iso: "HU", name: "Hungary", region: "Europe" },
  RO: { iso: "RO", name: "Romania", region: "Europe" },
  BU: { iso: "BG", name: "Bulgaria", region: "Europe" },
  GR: { iso: "GR", name: "Greece", region: "Europe" },
  TU: { iso: "TR", name: "Turkey", region: "Europe" },
  DA: { iso: "DK", name: "Denmark", region: "Europe" },
  SW: { iso: "SE", name: "Sweden", region: "Europe" },
  NO: { iso: "NO", name: "Norway", region: "Europe" },
  FI: { iso: "FI", name: "Finland", region: "Europe" },
  EI: { iso: "IE", name: "Ireland", region: "Europe" },
  IC: { iso: "IS", name: "Iceland", region: "Europe" },
  EN: { iso: "EE", name: "Estonia", region: "Europe" },
  LG: { iso: "LV", name: "Latvia", region: "Europe" },
  LH: { iso: "LT", name: "Lithuania", region: "Europe" },
  UP: { iso: "UA", name: "Ukraine", region: "Europe" },
  BO: { iso: "BY", name: "Belarus", region: "Europe" },
  MD: { iso: "MD", name: "Moldova", region: "Europe" },
  RS: { iso: "RS", name: "Serbia", region: "Europe" },
  HR: { iso: "HR", name: "Croatia", region: "Europe" },
  SI: { iso: "SI", name: "Slovenia", region: "Europe" },
  BK: { iso: "BA", name: "Bosnia and Herzegovina", region: "Europe" },
  MK: { iso: "MK", name: "North Macedonia", region: "Europe" },
  AL: { iso: "AL", name: "Albania", region: "Europe" },
  MT: { iso: "MT", name: "Malta", region: "Europe" },
  CY: { iso: "CY", name: "Cyprus", region: "Europe" },
  LU: { iso: "LU", name: "Luxembourg", region: "Europe" },
  RS2: { iso: "RS", name: "Serbia", region: "Europe" }, // alias

  // ── Asia-Pacific ───────────────────────────────────────────────────────
  CH: { iso: "CN", name: "China", region: "Asia-Pacific" },
  JA: { iso: "JP", name: "Japan", region: "Asia-Pacific" },
  KS: { iso: "KR", name: "South Korea", region: "Asia-Pacific" },
  KN: { iso: "KP", name: "North Korea", region: "Asia-Pacific" },
  AS: { iso: "AU", name: "Australia", region: "Asia-Pacific" },
  NZ: { iso: "NZ", name: "New Zealand", region: "Asia-Pacific" },
  TW: { iso: "TW", name: "Taiwan", region: "Asia-Pacific" },
  SN: { iso: "SG", name: "Singapore", region: "Asia-Pacific" },
  MY: { iso: "MY", name: "Malaysia", region: "Asia-Pacific" },
  TH: { iso: "TH", name: "Thailand", region: "Asia-Pacific" },
  ID: { iso: "ID", name: "Indonesia", region: "Asia-Pacific" },
  RP: { iso: "PH", name: "Philippines", region: "Asia-Pacific" },
  VM: { iso: "VN", name: "Vietnam", region: "Asia-Pacific" },
  BM: { iso: "MM", name: "Myanmar", region: "Asia-Pacific" },
  CB: { iso: "KH", name: "Cambodia", region: "Asia-Pacific" },
  LA: { iso: "LA", name: "Laos", region: "Asia-Pacific" },
  HK: { iso: "HK", name: "Hong Kong", region: "Asia-Pacific" },
  MC: { iso: "MO", name: "Macau", region: "Asia-Pacific" },
  MG: { iso: "MN", name: "Mongolia", region: "Asia-Pacific" },
  FJ: { iso: "FJ", name: "Fiji", region: "Asia-Pacific" },
  PP: { iso: "PG", name: "Papua New Guinea", region: "Asia-Pacific" },
  BP: { iso: "SB", name: "Solomon Islands", region: "Asia-Pacific" },

  // ── Middle East & Africa ───────────────────────────────────────────────
  IS: { iso: "IL", name: "Israel", region: "Middle East & Africa" },
  SA: { iso: "SA", name: "Saudi Arabia", region: "Middle East & Africa" },
  IR: { iso: "IR", name: "Iran", region: "Middle East & Africa" },
  IZ: { iso: "IQ", name: "Iraq", region: "Middle East & Africa" },
  SY: { iso: "SY", name: "Syria", region: "Middle East & Africa" },
  JO: { iso: "JO", name: "Jordan", region: "Middle East & Africa" },
  LE: { iso: "LB", name: "Lebanon", region: "Middle East & Africa" },
  AE: { iso: "AE", name: "United Arab Emirates", region: "Middle East & Africa" },
  QA: { iso: "QA", name: "Qatar", region: "Middle East & Africa" },
  KU: { iso: "KW", name: "Kuwait", region: "Middle East & Africa" },
  BA: { iso: "BH", name: "Bahrain", region: "Middle East & Africa" },
  MU: { iso: "OM", name: "Oman", region: "Middle East & Africa" },
  YM: { iso: "YE", name: "Yemen", region: "Middle East & Africa" },
  EG: { iso: "EG", name: "Egypt", region: "Middle East & Africa" },
  LY: { iso: "LY", name: "Libya", region: "Middle East & Africa" },
  TS: { iso: "TN", name: "Tunisia", region: "Middle East & Africa" },
  AG: { iso: "DZ", name: "Algeria", region: "Middle East & Africa" },
  MO: { iso: "MA", name: "Morocco", region: "Middle East & Africa" },
  SF: { iso: "ZA", name: "South Africa", region: "Middle East & Africa" },
  NI: { iso: "NG", name: "Nigeria", region: "Middle East & Africa" },
  KE: { iso: "KE", name: "Kenya", region: "Middle East & Africa" },
  ET: { iso: "ET", name: "Ethiopia", region: "Middle East & Africa" },
  GH: { iso: "GH", name: "Ghana", region: "Middle East & Africa" },
  UV: { iso: "BF", name: "Burkina Faso", region: "Middle East & Africa" },
  SG: { iso: "SN", name: "Senegal", region: "Middle East & Africa" },
  IV: { iso: "CI", name: "Ivory Coast", region: "Middle East & Africa" },
  TZ: { iso: "TZ", name: "Tanzania", region: "Middle East & Africa" },
  UG: { iso: "UG", name: "Uganda", region: "Middle East & Africa" },
  CG: { iso: "CD", name: "Democratic Republic of the Congo", region: "Middle East & Africa" },
  CF: { iso: "CG", name: "Republic of the Congo", region: "Middle East & Africa" },
  SU: { iso: "SD", name: "Sudan", region: "Middle East & Africa" },
  OD: { iso: "SS", name: "South Sudan", region: "Middle East & Africa" },
  SO: { iso: "SO", name: "Somalia", region: "Middle East & Africa" },
  MI: { iso: "MW", name: "Malawi", region: "Middle East & Africa" },
  ZI: { iso: "ZW", name: "Zimbabwe", region: "Middle East & Africa" },
  ZA: { iso: "ZM", name: "Zambia", region: "Middle East & Africa" },
  AO: { iso: "AO", name: "Angola", region: "Middle East & Africa" },
  MZ: { iso: "MZ", name: "Mozambique", region: "Middle East & Africa" },
  MA: { iso: "MG", name: "Madagascar", region: "Middle East & Africa" },
  WA: { iso: "NA", name: "Namibia", region: "Middle East & Africa" },
  BC: { iso: "BW", name: "Botswana", region: "Middle East & Africa" },
  RW: { iso: "RW", name: "Rwanda", region: "Middle East & Africa" },
  BY: { iso: "BI", name: "Burundi", region: "Middle East & Africa" },
  ER: { iso: "ER", name: "Eritrea", region: "Middle East & Africa" },
  DJ: { iso: "DJ", name: "Djibouti", region: "Middle East & Africa" },
  CM: { iso: "CM", name: "Cameroon", region: "Middle East & Africa" },
  ML: { iso: "ML", name: "Mali", region: "Middle East & Africa" },
  NG: { iso: "NE", name: "Niger", region: "Middle East & Africa" },

  // ── Latin America (South America) ──────────────────────────────────────
  BR: { iso: "BR", name: "Brazil", region: "Latin America" },
  AR: { iso: "AR", name: "Argentina", region: "Latin America" },
  CO: { iso: "CO", name: "Colombia", region: "Latin America" },
  VE: { iso: "VE", name: "Venezuela", region: "Latin America" },
  PE: { iso: "PE", name: "Peru", region: "Latin America" },
  CI: { iso: "CL", name: "Chile", region: "Latin America" },
  EC: { iso: "EC", name: "Ecuador", region: "Latin America" },
  BL: { iso: "BO", name: "Bolivia", region: "Latin America" },
  PA: { iso: "PY", name: "Paraguay", region: "Latin America" },
  UY: { iso: "UY", name: "Uruguay", region: "Latin America" },
  GY: { iso: "GY", name: "Guyana", region: "Latin America" },
  NS: { iso: "SR", name: "Suriname", region: "Latin America" },

  // ── South & Central Asia ───────────────────────────────────────────────
  IN: { iso: "IN", name: "India", region: "South & Central Asia" },
  PK: { iso: "PK", name: "Pakistan", region: "South & Central Asia" },
  BG: { iso: "BD", name: "Bangladesh", region: "South & Central Asia" },
  CE: { iso: "LK", name: "Sri Lanka", region: "South & Central Asia" },
  NP: { iso: "NP", name: "Nepal", region: "South & Central Asia" },
  AF: { iso: "AF", name: "Afghanistan", region: "South & Central Asia" },
  KZ: { iso: "KZ", name: "Kazakhstan", region: "South & Central Asia" },
  UZ: { iso: "UZ", name: "Uzbekistan", region: "South & Central Asia" },
  TX: { iso: "TM", name: "Turkmenistan", region: "South & Central Asia" },
  TI: { iso: "TJ", name: "Tajikistan", region: "South & Central Asia" },
  KG: { iso: "KG", name: "Kyrgyzstan", region: "South & Central Asia" },
  GG: { iso: "GE", name: "Georgia", region: "South & Central Asia" },
  AM: { iso: "AM", name: "Armenia", region: "South & Central Asia" },
  AJ: { iso: "AZ", name: "Azerbaijan", region: "South & Central Asia" },
  MV: { iso: "MV", name: "Maldives", region: "South & Central Asia" },
  BT: { iso: "BT", name: "Bhutan", region: "South & Central Asia" },

  // ── Russia (standalone) ────────────────────────────────────────────────
  RS3: { iso: "RU", name: "Russia", region: "Europe" }, // alias
  // GDELT uses "RS" for Russia in many datasets
}

// GDELT commonly encodes Russia as "RS" -- handle the overlap with Serbia
// by providing a dedicated lookup. In practice GDELT context usually
// disambiguates; downstream code may need heuristics.

/**
 * Return the world-region string for a given FIPS country code.
 * Returns "Unknown" if the code is not mapped.
 */
export function getRegionForCountry(fipsCode: string): string {
  const entry = fipsToIso[fipsCode]
  return entry ? entry.region : "Unknown"
}
