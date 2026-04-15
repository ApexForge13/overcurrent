// Domains to exclude from source discovery entirely.
// These are syndication networks that republish identical wire copy
// under country-branded domains. They add no editorial value and
// all return 403 on fetch attempts.
export const BLOCKED_DOMAINS: Set<string> = new Set([
  'cambodiantimes.com',
  'singaporestar.com',
  'japanherald.com',
  'malaysiasun.com',
  'bruneinews.net',
  'australiannews.net',
  'shanghainews.net',
  'chinanationalnews.com',
  'newzealandstar.com',
  'hongkongherald.com',
  'kenyastar.com',
  'middleeaststar.com',
  'europesun.com',
  'russiaherald.com',
  'heraldglobe.com',
  'bignewsnetwork.com',
  'austinglobe.com',
  'bostonstar.com',
  'iranherald.com',
  'asiabulletin.com',
  // Additional known syndication spam
  'newsreadonline.com',
  'worldnewsera.com',
  'thenewsguru.com',
  'newsnow.co.uk',
])

export function isBlockedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return BLOCKED_DOMAINS.has(hostname)
  } catch {
    return false
  }
}
