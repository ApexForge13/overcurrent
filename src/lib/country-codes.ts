// Full country name → ISO 3166-1 alpha-2 mapping
// Used by timeline builder, map classifier, and pipeline source metadata
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Argentina': 'AR',
  'Armenia': 'AM', 'Australia': 'AU', 'Austria': 'AT', 'Azerbaijan': 'AZ',
  'Bahrain': 'BH', 'Bangladesh': 'BD', 'Barbados': 'BB', 'Belarus': 'BY',
  'Belgium': 'BE', 'Bolivia': 'BO', 'Bosnia and Herzegovina': 'BA', 'Bosnia': 'BA',
  'Botswana': 'BW', 'Brazil': 'BR', 'Brunei': 'BN', 'Bulgaria': 'BG',
  'Burkina Faso': 'BF', 'Cambodia': 'KH', 'Cameroon': 'CM', 'Canada': 'CA',
  'Chile': 'CL', 'China': 'CN', 'Colombia': 'CO', 'Congo': 'CD',
  'Costa Rica': 'CR', 'Croatia': 'HR', 'Cuba': 'CU', 'Cyprus': 'CY',
  'Czech Republic': 'CZ', 'Czechia': 'CZ', 'Denmark': 'DK',
  'Dominican Republic': 'DO', 'Ecuador': 'EC', 'Egypt': 'EG',
  'El Salvador': 'SV', 'Estonia': 'EE', 'Ethiopia': 'ET', 'Fiji': 'FJ',
  'Finland': 'FI', 'France': 'FR', 'Georgia': 'GE', 'Germany': 'DE',
  'Ghana': 'GH', 'Greece': 'GR', 'Guatemala': 'GT', 'Guinea': 'GN',
  'Haiti': 'HT', 'Honduras': 'HN', 'Hong Kong': 'HK', 'Hungary': 'HU',
  'Iceland': 'IS', 'India': 'IN', 'Indonesia': 'ID', 'Iran': 'IR',
  'Iraq': 'IQ', 'Ireland': 'IE', 'Israel': 'IL', 'Italy': 'IT',
  'Ivory Coast': 'CI', 'Jamaica': 'JM', 'Japan': 'JP', 'Jordan': 'JO',
  'Kazakhstan': 'KZ', 'Kenya': 'KE', 'Kosovo': 'XK', 'Kuwait': 'KW',
  'Kyrgyzstan': 'KG', 'Laos': 'LA', 'Latvia': 'LV', 'Lebanon': 'LB',
  'Libya': 'LY', 'Lithuania': 'LT', 'Luxembourg': 'LU',
  'Macedonia': 'MK', 'North Macedonia': 'MK', 'Madagascar': 'MG',
  'Malawi': 'MW', 'Malaysia': 'MY', 'Maldives': 'MV', 'Mali': 'ML',
  'Malta': 'MT', 'Mexico': 'MX', 'Moldova': 'MD', 'Mongolia': 'MN',
  'Montenegro': 'ME', 'Morocco': 'MA', 'Mozambique': 'MZ', 'Myanmar': 'MM',
  'Namibia': 'NA', 'Nepal': 'NP', 'Netherlands': 'NL', 'New Zealand': 'NZ',
  'Nicaragua': 'NI', 'Niger': 'NE', 'Nigeria': 'NG', 'Norway': 'NO',
  'Oman': 'OM', 'Pakistan': 'PK', 'Palestine': 'PS', 'Panama': 'PA',
  'Papua New Guinea': 'PG', 'Paraguay': 'PY', 'Peru': 'PE',
  'Philippines': 'PH', 'Poland': 'PL', 'Portugal': 'PT',
  'Puerto Rico': 'PR', 'Qatar': 'QA', 'Romania': 'RO', 'Russia': 'RU',
  'Russian Federation': 'RU', 'Rwanda': 'RW', 'Saudi Arabia': 'SA',
  'Senegal': 'SN', 'Serbia': 'RS', 'Singapore': 'SG', 'Slovakia': 'SK',
  'Slovak Republic': 'SK', 'Slovenia': 'SI', 'Solomon Islands': 'SB',
  'Somalia': 'SO', 'South Africa': 'ZA', 'South Korea': 'KR', 'Korea': 'KR',
  'Spain': 'ES', 'Sri Lanka': 'LK', 'Sudan': 'SD', 'Sweden': 'SE',
  'Switzerland': 'CH', 'Syria': 'SY', 'Taiwan': 'TW', 'Tajikistan': 'TJ',
  'Tanzania': 'TZ', 'Thailand': 'TH', 'Tonga': 'TO',
  'Trinidad and Tobago': 'TT', 'Tunisia': 'TN', 'Turkey': 'TR',
  'Turkmenistan': 'TM', 'Uganda': 'UG', 'Ukraine': 'UA',
  'United Arab Emirates': 'AE', 'UAE': 'AE',
  'United Kingdom': 'GB', 'UK': 'GB',
  'United States': 'US', 'USA': 'US', 'U.S.': 'US',
  'Uruguay': 'UY', 'Uzbekistan': 'UZ', 'Vanuatu': 'VU',
  'Venezuela': 'VE', 'Vietnam': 'VN', 'Yemen': 'YE',
  'Zambia': 'ZM', 'Zimbabwe': 'ZW',
}

// Build lowercase lookup for case-insensitive matching
const LOWER_LOOKUP = new Map<string, string>()
for (const [name, code] of Object.entries(COUNTRY_NAME_TO_ISO)) {
  LOWER_LOOKUP.set(name.toLowerCase(), code)
}

/**
 * Normalize any country identifier to a 2-letter ISO code.
 * Accepts: "US", "us", "United States", "USA", "united states", etc.
 * Returns null if unresolvable — callers should SKIP the source, not default to US.
 */
export function normalizeCountryCode(input: string | null | undefined): string | null {
  if (!input || input.trim() === '') return null

  const trimmed = input.trim()

  // Already a 2-letter code
  if (trimmed.length === 2) return trimmed.toUpperCase()

  // 3-letter common abbreviations
  if (trimmed.length === 3) {
    const upper = trimmed.toUpperCase()
    if (upper === 'USA') return 'US'
    if (upper === 'GBR') return 'GB'
    if (upper === 'UAE') return 'AE'
  }

  // Full name lookup (case-insensitive)
  const found = LOWER_LOOKUP.get(trimmed.toLowerCase())
  if (found) return found

  return null
}

/**
 * Infer a region name from an ISO country code.
 * Returns null if unknown — callers should skip, not default.
 */
export function inferRegionFromCountryCode(isoCode: string | null): string | null {
  if (!isoCode) return null
  const c = isoCode.toUpperCase()

  // North America
  if (['US', 'CA', 'MX'].includes(c)) return 'North America'

  // Latin America
  if (['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO', 'CR', 'PA',
       'GT', 'HN', 'SV', 'NI', 'CU', 'DO', 'PR', 'JM', 'TT', 'BB', 'HT'].includes(c)) return 'Latin America'

  // Europe
  if (['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK',
       'FI', 'IE', 'PT', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'RS', 'BA',
       'SI', 'LT', 'LV', 'EE', 'AL', 'MK', 'ME', 'XK', 'MD', 'UA', 'BY', 'RU',
       'GE', 'AM', 'AZ', 'LU', 'IS', 'MT', 'CY'].includes(c)) return 'Europe'

  // Asia-Pacific
  if (['CN', 'JP', 'KR', 'TW', 'HK', 'SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'MM',
       'KH', 'AU', 'NZ', 'FJ', 'PG', 'BN', 'MN', 'LA', 'SB', 'TO', 'VU'].includes(c)) return 'Asia-Pacific'

  // South & Central Asia
  if (['IN', 'PK', 'BD', 'LK', 'NP', 'AF', 'MV', 'KZ', 'UZ', 'KG', 'TJ', 'TM'].includes(c)) return 'South & Central Asia'

  // Middle East & Africa
  if (['TR', 'IL', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'IR',
       'SY', 'EG', 'LY', 'TN', 'DZ', 'MA', 'SD', 'ET', 'KE', 'NG', 'GH', 'ZA',
       'TZ', 'UG', 'CM', 'SN', 'RW', 'ZW', 'ZM', 'MZ', 'ML', 'SO', 'YE', 'PS',
       'BW', 'NA', 'MG', 'NE', 'BF', 'GN', 'MW', 'CI'].includes(c)) return 'Middle East & Africa'

  return null
}
