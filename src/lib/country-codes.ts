/**
 * Comprehensive country code normalization.
 * Maps every common variant (full name, short name, demonym, abbreviation,
 * alternate spelling, ISO-3, native name) to ISO 3166-1 alpha-2.
 */

const COUNTRY_VARIANTS: Record<string, string> = {
  // ─── AFGHANISTAN ───
  'afghanistan': 'AF', 'afg': 'AF', 'afghani': 'AF', 'afghan': 'AF',
  // ─── ALBANIA ───
  'albania': 'AL', 'alb': 'AL', 'albanian': 'AL',
  // ─── ALGERIA ───
  'algeria': 'DZ', 'dza': 'DZ', 'algerian': 'DZ',
  // ─── ARGENTINA ───
  'argentina': 'AR', 'arg': 'AR', 'argentine': 'AR', 'argentinian': 'AR',
  // ─── ARMENIA ───
  'armenia': 'AM', 'arm': 'AM', 'armenian': 'AM',
  // ─── AUSTRALIA ───
  'australia': 'AU', 'aus': 'AU', 'australian': 'AU', 'oz': 'AU',
  // ─── AUSTRIA ───
  'austria': 'AT', 'aut': 'AT', 'austrian': 'AT', 'österreich': 'AT',
  // ─── AZERBAIJAN ───
  'azerbaijan': 'AZ', 'aze': 'AZ', 'azerbaijani': 'AZ',
  // ─── BAHRAIN ───
  'bahrain': 'BH', 'bhr': 'BH', 'bahraini': 'BH',
  // ─── BANGLADESH ───
  'bangladesh': 'BD', 'bgd': 'BD', 'bangladeshi': 'BD',
  // ─── BARBADOS ───
  'barbados': 'BB', 'brb': 'BB', 'barbadian': 'BB',
  // ─── BELARUS ───
  'belarus': 'BY', 'blr': 'BY', 'belarusian': 'BY', 'belorussia': 'BY',
  // ─── BELGIUM ───
  'belgium': 'BE', 'bel': 'BE', 'belgian': 'BE', 'belgique': 'BE',
  // ─── BOLIVIA ───
  'bolivia': 'BO', 'bol': 'BO', 'bolivian': 'BO',
  // ─── BOSNIA ───
  'bosnia and herzegovina': 'BA', 'bosnia': 'BA', 'bih': 'BA',
  'bosnia & herzegovina': 'BA', 'bosnian': 'BA', 'herzegovina': 'BA',
  // ─── BOTSWANA ───
  'botswana': 'BW', 'bwa': 'BW',
  // ─── BRAZIL ───
  'brazil': 'BR', 'bra': 'BR', 'brazilian': 'BR', 'brasil': 'BR',
  // ─── BRUNEI ───
  'brunei': 'BN', 'brn': 'BN', 'bruneian': 'BN', 'brunei darussalam': 'BN',
  // ─── BULGARIA ───
  'bulgaria': 'BG', 'bgr': 'BG', 'bulgarian': 'BG',
  // ─── BURKINA FASO ───
  'burkina faso': 'BF', 'bfa': 'BF', 'burkinabe': 'BF',
  // ─── CAMBODIA ───
  'cambodia': 'KH', 'khm': 'KH', 'cambodian': 'KH', 'kampuchea': 'KH',
  // ─── CAMEROON ───
  'cameroon': 'CM', 'cmr': 'CM', 'cameroonian': 'CM',
  // ─── CANADA ───
  'canada': 'CA', 'can': 'CA', 'canadian': 'CA',
  // ─── CHILE ───
  'chile': 'CL', 'chl': 'CL', 'chilean': 'CL',
  // ─── CHINA ───
  'china': 'CN', 'chn': 'CN', 'chinese': 'CN',
  "people's republic of china": 'CN', 'prc': 'CN', 'mainland china': 'CN',
  // ─── COLOMBIA ───
  'colombia': 'CO', 'col': 'CO', 'colombian': 'CO',
  // ─── CONGO ───
  'congo': 'CD', 'cod': 'CD', 'drc': 'CD', 'dr congo': 'CD',
  'democratic republic of the congo': 'CD', 'democratic republic of congo': 'CD',
  // ─── COSTA RICA ───
  'costa rica': 'CR', 'cri': 'CR', 'costa rican': 'CR',
  // ─── CROATIA ───
  'croatia': 'HR', 'hrv': 'HR', 'croatian': 'HR', 'hrvatska': 'HR',
  // ─── CUBA ───
  'cuba': 'CU', 'cub': 'CU', 'cuban': 'CU',
  // ─── CYPRUS ───
  'cyprus': 'CY', 'cyp': 'CY', 'cypriot': 'CY',
  // ─── CZECH REPUBLIC ───
  'czech republic': 'CZ', 'czechia': 'CZ', 'cze': 'CZ', 'czech': 'CZ',
  // ─── DENMARK ───
  'denmark': 'DK', 'dnk': 'DK', 'danish': 'DK', 'danmark': 'DK',
  // ─── DOMINICAN REPUBLIC ───
  'dominican republic': 'DO', 'dom': 'DO', 'dominican': 'DO',
  // ─── ECUADOR ───
  'ecuador': 'EC', 'ecu': 'EC', 'ecuadorian': 'EC',
  // ─── EGYPT ───
  'egypt': 'EG', 'egy': 'EG', 'egyptian': 'EG',
  // ─── EL SALVADOR ───
  'el salvador': 'SV', 'slv': 'SV', 'salvadoran': 'SV',
  // ─── ESTONIA ───
  'estonia': 'EE', 'est': 'EE', 'estonian': 'EE', 'eesti': 'EE',
  // ─── ETHIOPIA ───
  'ethiopia': 'ET', 'eth': 'ET', 'ethiopian': 'ET',
  // ─── FIJI ───
  'fiji': 'FJ', 'fji': 'FJ', 'fijian': 'FJ',
  // ─── FINLAND ───
  'finland': 'FI', 'fin': 'FI', 'finnish': 'FI', 'suomi': 'FI',
  // ─── FRANCE ───
  'france': 'FR', 'fra': 'FR', 'french': 'FR',
  // ─── GEORGIA ───
  'georgia': 'GE', 'geo': 'GE', 'georgian': 'GE',
  // ─── GERMANY ───
  'germany': 'DE', 'deu': 'DE', 'german': 'DE',
  'deutschland': 'DE', 'federal republic of germany': 'DE', 'ger': 'DE',
  // ─── GHANA ───
  'ghana': 'GH', 'gha': 'GH', 'ghanaian': 'GH',
  // ─── GREECE ───
  'greece': 'GR', 'grc': 'GR', 'greek': 'GR', 'hellas': 'GR', 'ellada': 'GR',
  // ─── GUATEMALA ───
  'guatemala': 'GT', 'gtm': 'GT', 'guatemalan': 'GT',
  // ─── GUINEA ───
  'guinea': 'GN', 'gin': 'GN', 'guinean': 'GN',
  // ─── GUYANA ───
  'guyana': 'GY', 'guy': 'GY', 'guyanese': 'GY',
  // ─── HAITI ───
  'haiti': 'HT', 'hti': 'HT', 'haitian': 'HT',
  // ─── HONDURAS ───
  'honduras': 'HN', 'hnd': 'HN', 'honduran': 'HN',
  // ─── HONG KONG ───
  'hong kong': 'HK', 'hkg': 'HK',
  // ─── HUNGARY ───
  'hungary': 'HU', 'hun': 'HU', 'hungarian': 'HU', 'magyarorszag': 'HU', 'magyarország': 'HU',
  // ─── ICELAND ───
  'iceland': 'IS', 'isl': 'IS', 'icelandic': 'IS', 'ísland': 'IS',
  // ─── INDIA ───
  'india': 'IN', 'ind': 'IN', 'indian': 'IN', 'bharat': 'IN',
  // ─── INDONESIA ───
  'indonesia': 'ID', 'idn': 'ID', 'indonesian': 'ID',
  // ─── IRAN ───
  'iran': 'IR', 'irn': 'IR', 'iranian': 'IR', 'islamic republic of iran': 'IR',
  'persia': 'IR', 'persian': 'IR',
  // ─── IRAQ ───
  'iraq': 'IQ', 'irq': 'IQ', 'iraqi': 'IQ',
  // ─── IRELAND ───
  'ireland': 'IE', 'irl': 'IE', 'irish': 'IE', 'republic of ireland': 'IE',
  'eire': 'IE', 'éire': 'IE',
  // ─── ISRAEL ───
  'israel': 'IL', 'isr': 'IL', 'israeli': 'IL',
  // ─── ITALY ───
  'italy': 'IT', 'ita': 'IT', 'italian': 'IT', 'italia': 'IT',
  // ─── IVORY COAST ───
  'ivory coast': 'CI', 'civ': 'CI', 'ivorian': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI',
  // ─── JAMAICA ───
  'jamaica': 'JM', 'jam': 'JM', 'jamaican': 'JM',
  // ─── JAPAN ───
  'japan': 'JP', 'jpn': 'JP', 'japanese': 'JP', 'nippon': 'JP', 'nihon': 'JP',
  // ─── JORDAN ───
  'jordan': 'JO', 'jor': 'JO', 'jordanian': 'JO',
  // ─── KAZAKHSTAN ───
  'kazakhstan': 'KZ', 'kaz': 'KZ', 'kazakh': 'KZ',
  // ─── KENYA ───
  'kenya': 'KE', 'ken': 'KE', 'kenyan': 'KE',
  // ─── KOSOVO ───
  'kosovo': 'XK', 'xkx': 'XK', 'kosovar': 'XK', 'kosova': 'XK',
  // ─── KUWAIT ───
  'kuwait': 'KW', 'kwt': 'KW', 'kuwaiti': 'KW',
  // ─── KYRGYZSTAN ───
  'kyrgyzstan': 'KG', 'kgz': 'KG', 'kyrgyz': 'KG', 'kirghizia': 'KG',
  // ─── LAOS ───
  'laos': 'LA', 'lao': 'LA', 'lao pdr': 'LA', "lao people's democratic republic": 'LA',
  // ─── LATVIA ───
  'latvia': 'LV', 'lva': 'LV', 'latvian': 'LV', 'latvija': 'LV',
  // ─── LEBANON ───
  'lebanon': 'LB', 'lbn': 'LB', 'lebanese': 'LB',
  // ─── LIBYA ───
  'libya': 'LY', 'lby': 'LY', 'libyan': 'LY',
  // ─── LITHUANIA ───
  'lithuania': 'LT', 'ltu': 'LT', 'lithuanian': 'LT',
  // ─── LUXEMBOURG ───
  'luxembourg': 'LU', 'lux': 'LU', 'luxembourgish': 'LU',
  // ─── MADAGASCAR ───
  'madagascar': 'MG', 'mdg': 'MG', 'malagasy': 'MG',
  // ─── MALAWI ───
  'malawi': 'MW', 'mwi': 'MW', 'malawian': 'MW',
  // ─── MALAYSIA ───
  'malaysia': 'MY', 'mys': 'MY', 'malaysian': 'MY',
  // ─── MALDIVES ───
  'maldives': 'MV', 'mdv': 'MV', 'maldivian': 'MV',
  // ─── MALI ───
  'mali': 'ML', 'mli': 'ML', 'malian': 'ML',
  // ─── MALTA ───
  'malta': 'MT', 'mlt': 'MT', 'maltese': 'MT',
  // ─── NORTH MACEDONIA ───
  'north macedonia': 'MK', 'macedonia': 'MK', 'mkd': 'MK', 'macedonian': 'MK', 'fyrom': 'MK',
  // ─── MEXICO ───
  'mexico': 'MX', 'mex': 'MX', 'mexican': 'MX', 'méxico': 'MX',
  // ─── MOLDOVA ───
  'moldova': 'MD', 'mda': 'MD', 'moldovan': 'MD', 'republic of moldova': 'MD',
  // ─── MONGOLIA ───
  'mongolia': 'MN', 'mng': 'MN', 'mongolian': 'MN',
  // ─── MONTENEGRO ───
  'montenegro': 'ME', 'mne': 'ME', 'montenegrin': 'ME', 'crna gora': 'ME',
  // ─── MOROCCO ───
  'morocco': 'MA', 'mar': 'MA', 'moroccan': 'MA',
  // ─── MOZAMBIQUE ───
  'mozambique': 'MZ', 'moz': 'MZ', 'mozambican': 'MZ',
  // ─── MYANMAR ───
  'myanmar': 'MM', 'mmr': 'MM', 'burmese': 'MM', 'burma': 'MM',
  // ─── NAMIBIA ───
  'namibia': 'NA', 'nam': 'NA', 'namibian': 'NA',
  // ─── NEPAL ───
  'nepal': 'NP', 'npl': 'NP', 'nepali': 'NP', 'nepalese': 'NP',
  // ─── NETHERLANDS ───
  'netherlands': 'NL', 'nld': 'NL', 'dutch': 'NL', 'holland': 'NL',
  'the netherlands': 'NL', 'nederland': 'NL',
  // ─── NEW ZEALAND ───
  'new zealand': 'NZ', 'nzl': 'NZ', 'new zealander': 'NZ', 'aotearoa': 'NZ', 'kiwi': 'NZ',
  // ─── NICARAGUA ───
  'nicaragua': 'NI', 'nic': 'NI', 'nicaraguan': 'NI',
  // ─── NIGER ───
  'niger': 'NE', 'ner': 'NE', 'nigerien': 'NE',
  // ─── NIGERIA ───
  'nigeria': 'NG', 'nga': 'NG', 'nigerian': 'NG',
  // ─── NORTH KOREA ───
  'north korea': 'KP', 'prk': 'KP', "democratic people's republic of korea": 'KP', 'dprk': 'KP',
  // ─── NORWAY ───
  'norway': 'NO', 'nor': 'NO', 'norwegian': 'NO', 'norge': 'NO',
  // ─── OMAN ───
  'oman': 'OM', 'omn': 'OM', 'omani': 'OM',
  // ─── PAKISTAN ───
  'pakistan': 'PK', 'pak': 'PK', 'pakistani': 'PK',
  // ─── PALESTINE ───
  'palestine': 'PS', 'pse': 'PS', 'palestinian': 'PS',
  'palestinian territories': 'PS', 'state of palestine': 'PS',
  // ─── PANAMA ───
  'panama': 'PA', 'pan': 'PA', 'panamanian': 'PA',
  // ─── PAPUA NEW GUINEA ───
  'papua new guinea': 'PG', 'png': 'PG', 'papua new guinean': 'PG',
  // ─── PARAGUAY ───
  'paraguay': 'PY', 'pry': 'PY', 'paraguayan': 'PY',
  // ─── PERU ───
  'peru': 'PE', 'per': 'PE', 'peruvian': 'PE', 'perú': 'PE',
  // ─── PHILIPPINES ───
  'philippines': 'PH', 'phl': 'PH', 'filipino': 'PH', 'the philippines': 'PH', 'philippine': 'PH',
  // ─── POLAND ───
  'poland': 'PL', 'pol': 'PL', 'polish': 'PL', 'polska': 'PL',
  // ─── PORTUGAL ───
  'portugal': 'PT', 'prt': 'PT', 'portuguese': 'PT',
  // ─── PUERTO RICO ───
  'puerto rico': 'PR', 'pri': 'PR', 'puerto rican': 'PR',
  // ─── QATAR ───
  'qatar': 'QA', 'qat': 'QA', 'qatari': 'QA',
  // ─── ROMANIA ───
  'romania': 'RO', 'rou': 'RO', 'romanian': 'RO', 'românia': 'RO',
  // ─── RUSSIA ───
  'russia': 'RU', 'rus': 'RU', 'russian': 'RU',
  'russian federation': 'RU', 'rossiya': 'RU',
  // ─── RWANDA ───
  'rwanda': 'RW', 'rwa': 'RW', 'rwandan': 'RW',
  // ─── SAMOA ───
  'samoa': 'WS', 'wsm': 'WS', 'samoan': 'WS',
  // ─── SAUDI ARABIA ───
  'saudi arabia': 'SA', 'sau': 'SA', 'saudi': 'SA', 'ksa': 'SA',
  'kingdom of saudi arabia': 'SA',
  // ─── SENEGAL ───
  'senegal': 'SN', 'sen': 'SN', 'senegalese': 'SN', 'sénégal': 'SN',
  // ─── SERBIA ───
  'serbia': 'RS', 'srb': 'RS', 'serbian': 'RS', 'srbija': 'RS',
  // ─── SINGAPORE ───
  'singapore': 'SG', 'sgp': 'SG', 'singaporean': 'SG',
  // ─── SLOVAKIA ───
  'slovakia': 'SK', 'slovak republic': 'SK', 'svk': 'SK', 'slovak': 'SK', 'slovensko': 'SK',
  // ─── SLOVENIA ───
  'slovenia': 'SI', 'svn': 'SI', 'slovenian': 'SI', 'slovenija': 'SI',
  // ─── SOLOMON ISLANDS ───
  'solomon islands': 'SB', 'slb': 'SB',
  // ─── SOMALIA ───
  'somalia': 'SO', 'som': 'SO', 'somali': 'SO',
  // ─── SOUTH AFRICA ───
  'south africa': 'ZA', 'zaf': 'ZA', 'south african': 'ZA', 'rsa': 'ZA',
  // ─── SOUTH KOREA ───
  'south korea': 'KR', 'korea': 'KR', 'kor': 'KR', 'korean': 'KR',
  'republic of korea': 'KR', 'rok': 'KR',
  // ─── SPAIN ───
  'spain': 'ES', 'esp': 'ES', 'spanish': 'ES', 'españa': 'ES', 'espana': 'ES',
  // ─── SRI LANKA ───
  'sri lanka': 'LK', 'lka': 'LK', 'sri lankan': 'LK', 'ceylon': 'LK',
  // ─── SUDAN ───
  'sudan': 'SD', 'sdn': 'SD', 'sudanese': 'SD',
  // ─── SWEDEN ───
  'sweden': 'SE', 'swe': 'SE', 'swedish': 'SE', 'sverige': 'SE',
  // ─── SWITZERLAND ───
  'switzerland': 'CH', 'che': 'CH', 'swiss': 'CH',
  'schweiz': 'CH', 'suisse': 'CH', 'svizzera': 'CH',
  // ─── SYRIA ───
  'syria': 'SY', 'syr': 'SY', 'syrian': 'SY', 'syrian arab republic': 'SY',
  // ─── TAIWAN ───
  'taiwan': 'TW', 'twn': 'TW', 'taiwanese': 'TW', 'chinese taipei': 'TW',
  'formosa': 'TW', 'republic of china': 'TW', 'roc': 'TW',
  // ─── TAJIKISTAN ───
  'tajikistan': 'TJ', 'tjk': 'TJ', 'tajik': 'TJ',
  // ─── TANZANIA ───
  'tanzania': 'TZ', 'tza': 'TZ', 'tanzanian': 'TZ', 'united republic of tanzania': 'TZ',
  // ─── THAILAND ───
  'thailand': 'TH', 'tha': 'TH', 'thai': 'TH', 'siam': 'TH',
  // ─── TONGA ───
  'tonga': 'TO', 'ton': 'TO', 'tongan': 'TO',
  // ─── TRINIDAD AND TOBAGO ───
  'trinidad and tobago': 'TT', 'tto': 'TT', 'trinidadian': 'TT',
  'trinidad & tobago': 'TT', 'trinidad': 'TT',
  // ─── TUNISIA ───
  'tunisia': 'TN', 'tun': 'TN', 'tunisian': 'TN',
  // ─── TURKEY ───
  'turkey': 'TR', 'tur': 'TR', 'turkish': 'TR', 'türkiye': 'TR', 'turkiye': 'TR',
  // ─── TURKMENISTAN ───
  'turkmenistan': 'TM', 'tkm': 'TM', 'turkmen': 'TM',
  // ─── UGANDA ───
  'uganda': 'UG', 'uga': 'UG', 'ugandan': 'UG',
  // ─── UKRAINE ───
  'ukraine': 'UA', 'ukr': 'UA', 'ukrainian': 'UA',
  // ─── UAE ───
  'united arab emirates': 'AE', 'are': 'AE', 'emirati': 'AE',
  'uae': 'AE', 'emirates': 'AE',
  // ─── UNITED KINGDOM ───
  'united kingdom': 'GB', 'gbr': 'GB', 'british': 'GB',
  'uk': 'GB', 'britain': 'GB', 'great britain': 'GB',
  'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  'united kingdom of great britain and northern ireland': 'GB',
  // ─── UNITED STATES ───
  'united states': 'US', 'usa': 'US', 'american': 'US',
  'america': 'US', 'united states of america': 'US',
  'the united states': 'US', 'the us': 'US', 'the usa': 'US', 'states': 'US',
  // ─── URUGUAY ───
  'uruguay': 'UY', 'ury': 'UY', 'uruguayan': 'UY',
  // ─── UZBEKISTAN ───
  'uzbekistan': 'UZ', 'uzb': 'UZ', 'uzbek': 'UZ',
  // ─── VANUATU ───
  'vanuatu': 'VU', 'vut': 'VU', 'ni-vanuatu': 'VU',
  // ─── VENEZUELA ───
  'venezuela': 'VE', 'ven': 'VE', 'venezuelan': 'VE',
  // ─── VIETNAM ───
  'vietnam': 'VN', 'vnm': 'VN', 'vietnamese': 'VN', 'viet nam': 'VN',
  // ─── YEMEN ───
  'yemen': 'YE', 'yem': 'YE', 'yemeni': 'YE',
  // ─── ZAMBIA ───
  'zambia': 'ZM', 'zmb': 'ZM', 'zambian': 'ZM',
  // ─── ZIMBABWE ───
  'zimbabwe': 'ZW', 'zwe': 'ZW', 'zimbabwean': 'ZW',
}

// Build a Map for O(1) lookups including 2-letter ISO codes
const LOOKUP = new Map<string, string>()
for (const [key, val] of Object.entries(COUNTRY_VARIANTS)) {
  LOOKUP.set(key, val)
}
// Also add all 2-letter codes as keys
const ISO_CODES = new Set(Object.values(COUNTRY_VARIANTS))
for (const code of ISO_CODES) {
  LOOKUP.set(code.toLowerCase(), code)
}

/**
 * Normalize any country input to ISO 3166-1 alpha-2.
 * Returns null if unresolvable — callers should SKIP, not default to US.
 */
export function normalizeCountryCode(input: string | null | undefined): string | null {
  if (!input) return null

  const cleaned = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\./g, '')
  if (!cleaned) return null

  // Direct lookup
  const match = LOOKUP.get(cleaned)
  if (match) return match

  // Try removing "the " prefix
  if (cleaned.startsWith('the ')) {
    const withoutThe = LOOKUP.get(cleaned.slice(4))
    if (withoutThe) return withoutThe
  }

  // Try removing "republic of " prefix
  if (cleaned.startsWith('republic of ')) {
    const withoutRepublic = LOOKUP.get(cleaned.slice(13))
    if (withoutRepublic) return withoutRepublic
  }

  // Try removing "kingdom of " prefix
  if (cleaned.startsWith('kingdom of ')) {
    const withoutKingdom = LOOKUP.get(cleaned.slice(11))
    if (withoutKingdom) return withoutKingdom
  }

  return null
}

/**
 * Map ISO alpha-2 country code to Overcurrent region name.
 * Returns null for unmapped codes — callers should skip.
 */
export function inferRegionFromCountryCode(isoCode: string | null): string | null {
  if (!isoCode) return null
  return COUNTRY_TO_REGION[isoCode.toUpperCase()] || null
}

const COUNTRY_TO_REGION: Record<string, string> = {
  // North America
  US: 'North America', CA: 'North America', MX: 'North America', PR: 'North America',
  // Europe
  GB: 'Europe', IE: 'Europe', FR: 'Europe', DE: 'Europe', IT: 'Europe',
  ES: 'Europe', PT: 'Europe', NL: 'Europe', BE: 'Europe', LU: 'Europe',
  AT: 'Europe', CH: 'Europe', DK: 'Europe', SE: 'Europe', NO: 'Europe',
  FI: 'Europe', IS: 'Europe', PL: 'Europe', CZ: 'Europe', SK: 'Europe',
  HU: 'Europe', RO: 'Europe', BG: 'Europe', HR: 'Europe', SI: 'Europe',
  RS: 'Europe', BA: 'Europe', AL: 'Europe', MK: 'Europe', ME: 'Europe',
  XK: 'Europe', LT: 'Europe', LV: 'Europe', EE: 'Europe', MD: 'Europe',
  UA: 'Europe', BY: 'Europe', RU: 'Europe', GE: 'Europe', AM: 'Europe',
  AZ: 'Europe', MT: 'Europe', CY: 'Europe',
  // Middle East & Africa
  TR: 'Middle East & Africa', IL: 'Middle East & Africa', PS: 'Middle East & Africa',
  JO: 'Middle East & Africa', LB: 'Middle East & Africa', SY: 'Middle East & Africa',
  IQ: 'Middle East & Africa', IR: 'Middle East & Africa', KW: 'Middle East & Africa',
  SA: 'Middle East & Africa', AE: 'Middle East & Africa', QA: 'Middle East & Africa',
  BH: 'Middle East & Africa', OM: 'Middle East & Africa', YE: 'Middle East & Africa',
  EG: 'Middle East & Africa', LY: 'Middle East & Africa', TN: 'Middle East & Africa',
  DZ: 'Middle East & Africa', MA: 'Middle East & Africa', SD: 'Middle East & Africa',
  ET: 'Middle East & Africa', KE: 'Middle East & Africa', TZ: 'Middle East & Africa',
  UG: 'Middle East & Africa', RW: 'Middle East & Africa', NG: 'Middle East & Africa',
  GH: 'Middle East & Africa', SN: 'Middle East & Africa', ML: 'Middle East & Africa',
  CM: 'Middle East & Africa', ZA: 'Middle East & Africa', ZW: 'Middle East & Africa',
  ZM: 'Middle East & Africa', MZ: 'Middle East & Africa', SO: 'Middle East & Africa',
  BW: 'Middle East & Africa', NA: 'Middle East & Africa', MG: 'Middle East & Africa',
  NE: 'Middle East & Africa', BF: 'Middle East & Africa', GN: 'Middle East & Africa',
  MW: 'Middle East & Africa', CI: 'Middle East & Africa', CD: 'Middle East & Africa',
  // Asia-Pacific
  CN: 'Asia-Pacific', JP: 'Asia-Pacific', KR: 'Asia-Pacific', KP: 'Asia-Pacific',
  TW: 'Asia-Pacific', HK: 'Asia-Pacific', MN: 'Asia-Pacific',
  SG: 'Asia-Pacific', MY: 'Asia-Pacific', ID: 'Asia-Pacific', TH: 'Asia-Pacific',
  VN: 'Asia-Pacific', PH: 'Asia-Pacific', MM: 'Asia-Pacific', KH: 'Asia-Pacific',
  LA: 'Asia-Pacific', BN: 'Asia-Pacific', AU: 'Asia-Pacific', NZ: 'Asia-Pacific',
  FJ: 'Asia-Pacific', PG: 'Asia-Pacific', VU: 'Asia-Pacific', SB: 'Asia-Pacific',
  WS: 'Asia-Pacific', TO: 'Asia-Pacific',
  // South & Central Asia
  IN: 'South & Central Asia', PK: 'South & Central Asia', BD: 'South & Central Asia',
  LK: 'South & Central Asia', NP: 'South & Central Asia', AF: 'South & Central Asia',
  MV: 'South & Central Asia', KZ: 'South & Central Asia', UZ: 'South & Central Asia',
  KG: 'South & Central Asia', TJ: 'South & Central Asia', TM: 'South & Central Asia',
  // Latin America
  BR: 'Latin America', AR: 'Latin America', CL: 'Latin America', CO: 'Latin America',
  PE: 'Latin America', VE: 'Latin America', EC: 'Latin America', UY: 'Latin America',
  PY: 'Latin America', BO: 'Latin America', CR: 'Latin America', PA: 'Latin America',
  GT: 'Latin America', HN: 'Latin America', SV: 'Latin America', NI: 'Latin America',
  CU: 'Latin America', DO: 'Latin America', HT: 'Latin America', JM: 'Latin America',
  TT: 'Latin America', BB: 'Latin America', GY: 'Latin America',
}
