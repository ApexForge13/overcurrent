import { describe, it, expect } from 'vitest'
import { slugify } from '@/lib/utils'
import { stripDiacritics } from '@/ingestion/gdelt'
import { countryToRegionId } from '@/agents/map-classifier'
import { filterByKeywordRelevance, type RedditDiscoursePost } from '@/ingestion/reddit-discourse'
import { getOutletsWithRss, outlets, findOutletByDomain } from '@/data/outlets'

// ---------------------------------------------------------------------------
// 1. SLUG GENERATION — diacritics, special chars, edge cases
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases, strips diacritics, and hyphenates', () => {
    expect(slugify('Hungary Votes Out Orbán')).toBe('hungary-votes-out-orban')
  })

  it('produces same result with or without stripDiacritics preprocessing', () => {
    const raw = slugify('Hungary Votes Out Orbán After 16 Years')
    const preProcessed = slugify(stripDiacritics('Hungary Votes Out Orbán After 16 Years'))
    expect(raw).toBe('hungary-votes-out-orban-after-16-years')
    expect(raw).toBe(preProcessed)
  })

  it('handles apostrophes and quotes', () => {
    expect(slugify("Iran's Nuclear Deal Collapses")).toBe('irans-nuclear-deal-collapses')
  })

  it('handles colons and special punctuation', () => {
    expect(slugify('U.S. Naval Blockade: Iran Responds')).toBe('us-naval-blockade-iran-responds')
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(slugify('Trump  --  Tariffs   Hit  EU')).toBe('trump-tariffs-hit-eu')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---leading and trailing---')).toBe('leading-and-trailing')
  })

  it('handles CJK and non-Latin scripts (strips them)', () => {
    const result = slugify('台湾 Election 2026 選挙')
    expect(result).toBe('election-2026')
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('handles pure emoji/symbols', () => {
    expect(slugify('🇺🇸🇮🇷')).toBe('')
  })

  it('handles real-world headlines from pipeline', () => {
    const cases = [
      ['U.S. Naval Blockade of Iranian Ports Begins After Islamabad Peace Talks Collapse, Oil Surges Past $100 Before Easing', 'us-naval-blockade-of-iranian-ports-begins-after-islamabad-peace-talks-collapse-oil-surges-past-100-before-easing'],
      ['Erdoğan–Assad Meeting Signals Regional Shift', 'erdogan-assad-meeting-signals-regional-shift'],
      ['São Paulo Workers\' Strike Enters 3rd Week', 'sao-paulo-workers-strike-enters-3rd-week'],
    ] as const
    for (const [input, expected] of cases) {
      expect(slugify(input)).toBe(expected)
    }
  })
})

describe('stripDiacritics', () => {
  it('strips accents from common European names', () => {
    expect(stripDiacritics('Orbán')).toBe('Orban')
    expect(stripDiacritics('Erdoğan')).toBe('Erdogan')
    expect(stripDiacritics('São Paulo')).toBe('Sao Paulo')
    expect(stripDiacritics('Zürich')).toBe('Zurich')
    expect(stripDiacritics('naïve café résumé')).toBe('naive cafe resume')
  })

  it('leaves ASCII text unchanged', () => {
    expect(stripDiacritics('Hungary Votes Out Orban')).toBe('Hungary Votes Out Orban')
  })

  it('handles mixed diacritics and numbers', () => {
    expect(stripDiacritics('Elección 2026')).toBe('Eleccion 2026')
  })
})

// ---------------------------------------------------------------------------
// 2. RSS FEED CONFIGURATION INTEGRITY
// ---------------------------------------------------------------------------

describe('RSS feed configuration', () => {
  const rssOutlets = getOutletsWithRss()

  it('has at least 100 outlets with RSS feeds', () => {
    expect(rssOutlets.length).toBeGreaterThanOrEqual(100)
  })

  it('every rssUrl is a valid URL', () => {
    const invalid: string[] = []
    for (const outlet of rssOutlets) {
      try {
        new URL(outlet.rssUrl!)
      } catch {
        invalid.push(`${outlet.name}: ${outlet.rssUrl}`)
      }
    }
    expect(invalid).toEqual([])
  })

  it('no duplicate rssUrl values', () => {
    const urls = rssOutlets.map(o => o.rssUrl!)
    const dupes = urls.filter((u, i) => urls.indexOf(u) !== i)
    expect(dupes).toEqual([])
  })

  it('every outlet has valid required fields', () => {
    const problems: string[] = []
    for (const outlet of outlets) {
      if (!outlet.name) problems.push(`Missing name: ${outlet.domain}`)
      if (!outlet.domain) problems.push(`Missing domain: ${outlet.name}`)
      if (!outlet.country || outlet.country.length !== 2) problems.push(`Invalid country code for ${outlet.name}: "${outlet.country}"`)
      if (!outlet.region) problems.push(`Missing region for ${outlet.name}`)
      if (!['wire', 'newspaper', 'broadcaster', 'digital', 'state'].includes(outlet.type)) {
        problems.push(`Invalid type for ${outlet.name}: "${outlet.type}"`)
      }
      if (!['left', 'center-left', 'center', 'center-right', 'right', 'state-controlled', 'unknown'].includes(outlet.politicalLean)) {
        problems.push(`Invalid politicalLean for ${outlet.name}: "${outlet.politicalLean}"`)
      }
      if (!['high', 'medium', 'low', 'mixed'].includes(outlet.reliability)) {
        problems.push(`Invalid reliability for ${outlet.name}: "${outlet.reliability}"`)
      }
    }
    expect(problems).toEqual([])
  })

  it('no duplicate domains in outlet registry', () => {
    const domains = outlets.map(o => o.domain.toLowerCase())
    const dupes = domains.filter((d, i) => domains.indexOf(d) !== i)
    expect(dupes).toEqual([])
  })

  it('known state media outlets are flagged as state-controlled', () => {
    const stateMedia = ['rt.com', 'presstv.ir', 'xinhuanet.com', 'globaltimes.cn']
    for (const domain of stateMedia) {
      const outlet = findOutletByDomain(domain)
      if (outlet) {
        expect(outlet.politicalLean).toBe('state-controlled')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 3. MAP CLASSIFIER — region assignment contracts
// ---------------------------------------------------------------------------

describe('countryToRegionId', () => {
  it('assigns UK outlets to "uk" not "eu"', () => {
    expect(countryToRegionId('GB')).toBe('uk')
  })

  it('assigns Ireland to "uk" (same globe region)', () => {
    expect(countryToRegionId('IE')).toBe('uk')
  })

  it('assigns European countries to "eu"', () => {
    const euCountries = ['FR', 'DE', 'IT', 'ES', 'NL', 'SE', 'NO', 'HU', 'PL', 'UA']
    for (const c of euCountries) {
      expect(countryToRegionId(c)).toBe('eu')
    }
  })

  it('assigns Russia to "ru" not "eu"', () => {
    expect(countryToRegionId('RU')).toBe('ru')
  })

  it('assigns Turkey to "tr" not "eu" or "me"', () => {
    expect(countryToRegionId('TR')).toBe('tr')
  })

  it('assigns Pakistan to "pk" not "in"', () => {
    expect(countryToRegionId('PK')).toBe('pk')
  })

  it('assigns India/Bangladesh/Sri Lanka to "in"', () => {
    expect(countryToRegionId('IN')).toBe('in')
    expect(countryToRegionId('BD')).toBe('in')
    expect(countryToRegionId('LK')).toBe('in')
  })

  it('assigns Iran to "ir" not "me"', () => {
    expect(countryToRegionId('IR')).toBe('ir')
  })

  it('assigns Israel to "il" not "me"', () => {
    expect(countryToRegionId('IL')).toBe('il')
  })

  it('assigns Middle East countries to "me"', () => {
    const meCountries = ['SA', 'QA', 'AE', 'EG']
    for (const c of meCountries) {
      expect(countryToRegionId(c)).toBe('me')
    }
  })

  it('assigns Southeast Asian countries to "sea"', () => {
    const seaCountries = ['SG', 'TH', 'ID', 'MY', 'PH', 'VN']
    for (const c of seaCountries) {
      expect(countryToRegionId(c)).toBe('sea')
    }
  })

  it('assigns China/HK/Taiwan to "cn"', () => {
    expect(countryToRegionId('CN')).toBe('cn')
    expect(countryToRegionId('HK')).toBe('cn')
    expect(countryToRegionId('TW')).toBe('cn')
  })

  it('assigns Latin American countries to "la"', () => {
    const laCountries = ['BR', 'AR', 'CO', 'CL', 'PE', 'VE', 'UY']
    for (const c of laCountries) {
      expect(countryToRegionId(c)).toBe('la')
    }
  })

  it('falls back to "us" for unknown country codes', () => {
    expect(countryToRegionId('XX')).toBe('us')
    expect(countryToRegionId('')).toBe('us')
  })

  it('every outlet in the registry maps to a valid region_id', () => {
    const validRegions = new Set(['us', 'ca', 'mx', 'uk', 'eu', 'ru', 'tr', 'ir', 'il', 'me', 'af', 'in', 'pk', 'cn', 'jp', 'kr', 'sea', 'au', 'la'])
    const unmapped: string[] = []
    for (const outlet of outlets) {
      const regionId = countryToRegionId(outlet.country)
      if (!validRegions.has(regionId)) {
        unmapped.push(`${outlet.name} (${outlet.country}) → ${regionId}`)
      }
    }
    expect(unmapped).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. REDDIT KEYWORD FILTER — 2+ keyword match contract
// ---------------------------------------------------------------------------

describe('filterByKeywordRelevance', () => {
  function makePost(content: string, upvotes = 100): RedditDiscoursePost {
    return {
      platform: 'reddit',
      url: `https://reddit.com/r/test/${Math.random()}`,
      author: 'user',
      subreddit: 'worldnews',
      content,
      upvotes,
      comments: 10,
      createdUtc: Date.now() / 1000,
      topComments: [],
    }
  }

  it('accepts posts matching 2+ keywords', () => {
    const posts = [
      makePost('Hungary election results show Orban lost power'),
      makePost('Random post about cooking recipes'),
    ]
    const result = filterByKeywordRelevance(posts, ['Hungary', 'election', 'Orban'])
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('Hungary')
  })

  it('accepts posts with 1+ keyword match when no anchors (loosened filter)', () => {
    const posts = [
      makePost('Hungary election results show shift in power'),
      makePost('Hungary Orban coalition collapses after election'),
      makePost('The election in Hungary was historic for Europe'),
      makePost('Orban mentioned in unrelated context about cooking'),  // 1 keyword — now passes
    ]
    const result = filterByKeywordRelevance(posts, ['Hungary', 'election', 'Orban'])
    // Without explicit anchors, anchorHits=total, so 1 keyword+1 anchor match passes
    expect(result).toHaveLength(4)
  })

  it('falls back to 1-keyword match when <3 posts pass strict (no anchors)', () => {
    const posts = [
      makePost('Hungary election results'),      // 2 keywords → strict pass
      makePost('Orban spoke at a conference'),     // 1 keyword → fallback pass
      makePost('No relevant keywords at all'),     // 0 keywords → filtered
    ]
    const result = filterByKeywordRelevance(posts, ['Hungary', 'election', 'Orban'])
    // Only 1 passes strict (<3), so fallback to 1-keyword
    expect(result).toHaveLength(2)
  })

  it('is case-insensitive', () => {
    const posts = [makePost('HUNGARY ELECTION shows ORBAN lost')]
    const result = filterByKeywordRelevance(posts, ['hungary', 'election', 'orban'])
    expect(result).toHaveLength(1)
  })

  it('returns empty array when no keywords match', () => {
    const posts = [
      makePost('Completely unrelated post about sports'),
      makePost('Another post about weather'),
    ]
    const result = filterByKeywordRelevance(posts, ['Hungary', 'election', 'Orban'])
    expect(result).toHaveLength(0)
  })

  it('handles empty keyword list', () => {
    const posts = [makePost('Some post')]
    const result = filterByKeywordRelevance(posts, [])
    expect(result).toHaveLength(0)
  })

  it('handles empty post list', () => {
    const result = filterByKeywordRelevance([], ['Hungary', 'election'])
    expect(result).toHaveLength(0)
  })

  // ── ANCHOR-AWARE TESTS ──
  it('requires anchor match when anchors provided — filters generic political posts', () => {
    const posts = [
      makePost('Hungary election results show Orban lost power'),  // anchor: "hungary", "orban"
      makePost('Trump party wins big in latest election results'),  // NO anchor match
      makePost('Election season brings voter turnout debate'),       // NO anchor match
    ]
    const keywords = ['hungary', 'election', 'orban', 'party', 'results']
    const anchors = ['hungary', 'orban']
    const result = filterByKeywordRelevance(posts, keywords, anchors)
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('Hungary')
  })

  it('fallback still requires anchor when anchors provided', () => {
    const posts = [
      makePost('Orban spoke at Hungary conference'),   // 1 anchor + 1 keyword
      makePost('Election party wins debate'),            // 0 anchors, 2+ keywords
    ]
    const keywords = ['hungary', 'election', 'orban', 'party']
    const anchors = ['hungary', 'orban']
    // Only 1 post passes strict (< 3), fallback still requires anchor
    const result = filterByKeywordRelevance(posts, keywords, anchors)
    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('Orban')
  })

  it('backwards compatible — works without anchors (old behavior)', () => {
    const posts = [
      makePost('Hungary election results show Orban lost power'),
      makePost('Random post about cooking recipes'),
    ]
    // No anchors arg — same as before
    const result = filterByKeywordRelevance(posts, ['Hungary', 'election', 'Orban'])
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5. SLUGIFY + STRIP DIACRITICS INTEGRATION — the full pipeline path
// ---------------------------------------------------------------------------

describe('slug generation pipeline (slugify handles diacritics natively)', () => {
  function pipelineSlug(headline: string): string {
    // This is what pipeline.ts actually does: slugify(headline).slice(0, 80)
    return slugify(headline).slice(0, 80)
  }

  it('produces correct slugs for real headlines with diacritics', () => {
    const cases: [string, string][] = [
      ['Hungary Votes Out Orbán After 16 Years', 'hungary-votes-out-orban-after-16-years'],
      ['Erdoğan–Assad Meeting Signals Major Shift in Türkiye Foreign Policy', 'erdogan-assad-meeting-signals-major-shift-in-turkiye-foreign-policy'],
      ['São Paulo\'s Largest Strike Since Lula\'s Return Enters Third Week', 'sao-paulos-largest-strike-since-lulas-return-enters-third-week'],
      ['Zürich Summit: Macron and Scholz Clash Over Défense Budget', 'zurich-summit-macron-and-scholz-clash-over-defense-budget'],
      ['U.S. Naval Blockade of Iranian Ports Begins', 'us-naval-blockade-of-iranian-ports-begins'],
    ]
    for (const [headline, expected] of cases) {
      expect(pipelineSlug(headline)).toBe(expected)
    }
  })

  it('truncates at 80 chars for long headlines', () => {
    const long = 'A'.repeat(200)
    expect(pipelineSlug(long).length).toBeLessThanOrEqual(80)
  })

  it('never produces empty slug for non-empty headline', () => {
    const headlines = [
      'Simple Test',
      'Test 123',
      'Über-complicated héadlîne with mäny díacrïtics',
    ]
    for (const h of headlines) {
      expect(pipelineSlug(h).length).toBeGreaterThan(0)
    }
  })
})
