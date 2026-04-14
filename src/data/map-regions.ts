export interface MapRegion {
  id: string
  label: string
  x: number  // on a 680x400 SVG viewbox
  y: number
  radius: number
}

export const MAP_REGIONS: MapRegion[] = [
  { id: 'us',  label: 'United States',  x: 170, y: 180, radius: 18 },
  { id: 'ca',  label: 'Canada',         x: 180, y: 130, radius: 10 },
  { id: 'mx',  label: 'Mexico',         x: 155, y: 225, radius: 10 },
  { id: 'la',  label: 'Latin America',  x: 195, y: 290, radius: 12 },
  { id: 'uk',  label: 'United Kingdom', x: 330, y: 130, radius: 12 },
  { id: 'eu',  label: 'Europe',         x: 370, y: 160, radius: 14 },
  { id: 'ru',  label: 'Russia',         x: 450, y: 110, radius: 13 },
  { id: 'tr',  label: 'Turkey',         x: 400, y: 185, radius: 10 },
  { id: 'me',  label: 'Middle East',    x: 420, y: 215, radius: 12 },
  { id: 'ir',  label: 'Iran',           x: 445, y: 200, radius: 11 },
  { id: 'il',  label: 'Israel',         x: 405, y: 210, radius: 8 },
  { id: 'af',  label: 'Africa',         x: 370, y: 290, radius: 14 },
  { id: 'in',  label: 'India',          x: 500, y: 230, radius: 12 },
  { id: 'cn',  label: 'China',          x: 545, y: 175, radius: 14 },
  { id: 'jp',  label: 'Japan',          x: 595, y: 170, radius: 9 },
  { id: 'kr',  label: 'South Korea',    x: 580, y: 180, radius: 8 },
  { id: 'sea', label: 'SE Asia',        x: 555, y: 245, radius: 11 },
  { id: 'au',  label: 'Australia',      x: 590, y: 320, radius: 12 },
  { id: 'pk',  label: 'Pakistan',       x: 480, y: 215, radius: 9 },
]

export const COUNTRY_TO_MAP_REGION: Record<string, string> = {
  'US': 'us', 'CA': 'ca', 'MX': 'mx',
  'BR': 'la', 'AR': 'la', 'CO': 'la', 'VE': 'la', 'CL': 'la', 'PE': 'la', 'CU': 'la',
  'GB': 'uk', 'IE': 'uk',
  'DE': 'eu', 'FR': 'eu', 'ES': 'eu', 'IT': 'eu', 'NL': 'eu', 'BE': 'eu', 'AT': 'eu',
  'SE': 'eu', 'NO': 'eu', 'DK': 'eu', 'FI': 'eu', 'PL': 'eu', 'CZ': 'eu', 'RO': 'eu',
  'HU': 'eu', 'CH': 'eu', 'PT': 'eu', 'GR': 'eu',
  'RU': 'ru', 'UA': 'eu',
  'TR': 'tr',
  'SA': 'me', 'AE': 'me', 'QA': 'me', 'KW': 'me', 'IQ': 'me', 'LB': 'me', 'JO': 'me', 'EG': 'me', 'YE': 'me',
  'IR': 'ir', 'IL': 'il',
  'ZA': 'af', 'NG': 'af', 'KE': 'af', 'ET': 'af', 'GH': 'af', 'TZ': 'af',
  'IN': 'in', 'BD': 'in', 'LK': 'in', 'NP': 'in',
  'CN': 'cn', 'HK': 'cn', 'TW': 'cn',
  'JP': 'jp', 'KR': 'kr',
  'SG': 'sea', 'MY': 'sea', 'TH': 'sea', 'VN': 'sea', 'PH': 'sea', 'ID': 'sea',
  'AU': 'au', 'NZ': 'au',
  'PK': 'pk', 'AF': 'pk',
}

export const PROPAGATION_STATUS = {
  original:     { color: '#2A9D8F', label: 'Original' },
  wire_copy:    { color: '#378ADD', label: 'Wire copy' },
  reframed:     { color: '#F4A261', label: 'Reframed' },
  contradicted: { color: '#E24B4A', label: 'Contradicted' },
  silent:       { color: '#5C5A56', label: 'Silent' },
} as const

export type PropagationStatusType = keyof typeof PROPAGATION_STATUS
