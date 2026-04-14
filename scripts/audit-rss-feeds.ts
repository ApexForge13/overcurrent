/**
 * RSS Feed Audit Script
 * Tests all 203+ outlets' RSS feeds and reports on their health.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/audit-rss-feeds.ts
 *
 * Output: Categorized feed health report + suggested fixes
 */

import { outlets, OutletInfo } from '../src/data/outlets'

const RSS_TIMEOUT = 15_000

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
}

interface FeedResult {
  outlet: OutletInfo
  status: 'ok' | 'redirect' | 'http_error' | 'parse_error' | 'timeout' | 'network_error' | 'no_rss'
  httpStatus?: number
  redirectUrl?: string
  itemCount?: number
  error?: string
  latestItemDate?: string
  suggestedFix?: string
}

async function testFeed(outlet: OutletInfo): Promise<FeedResult> {
  if (!outlet.rssUrl) {
    return { outlet, status: 'no_rss' }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), RSS_TIMEOUT)

    let response: Response
    try {
      response = await fetch(outlet.rssUrl, {
        signal: controller.signal,
        headers: BROWSER_HEADERS,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timeoutId)
    }

    // Check for redirect
    const finalUrl = response.url
    const wasRedirected = finalUrl !== outlet.rssUrl

    if (!response.ok) {
      // Try common alternative URL patterns
      const suggested = await tryAlternativeUrls(outlet)
      return {
        outlet,
        status: 'http_error',
        httpStatus: response.status,
        suggestedFix: suggested || undefined,
      }
    }

    const xml = await response.text()

    // Basic XML validation
    if (!xml.includes('<rss') && !xml.includes('<feed') && !xml.includes('<channel')) {
      // Might be HTML (redirect to homepage)
      if (xml.includes('<html') || xml.includes('<!DOCTYPE')) {
        const suggested = await tryAlternativeUrls(outlet)
        return {
          outlet,
          status: 'parse_error',
          error: 'Response is HTML, not XML (likely redirect to homepage)',
          suggestedFix: suggested || undefined,
        }
      }
      return {
        outlet,
        status: 'parse_error',
        error: 'Response is not valid RSS/Atom XML',
      }
    }

    // Try to parse with rss-parser
    let itemCount = 0
    let latestItemDate: string | undefined
    try {
      const RssParser = (await import('rss-parser')).default || (await import('rss-parser'))
      const parser = new RssParser()
      const feed = await parser.parseString(xml)
      itemCount = feed.items?.length ?? 0
      latestItemDate = feed.items?.[0]?.isoDate || feed.items?.[0]?.pubDate || undefined
    } catch (parseErr) {
      // XML exists but parser choked — try sanitizing
      const sanitized = sanitizeXml(xml)
      try {
        const RssParser = (await import('rss-parser')).default || (await import('rss-parser'))
        const parser = new RssParser()
        const feed = await parser.parseString(sanitized)
        itemCount = feed.items?.length ?? 0
        latestItemDate = feed.items?.[0]?.isoDate || feed.items?.[0]?.pubDate || undefined
        // Parsed after sanitization — note this
        return {
          outlet,
          status: 'ok',
          itemCount,
          latestItemDate,
          redirectUrl: wasRedirected ? finalUrl : undefined,
          suggestedFix: 'Needs XML sanitization before parsing',
        }
      } catch {
        return {
          outlet,
          status: 'parse_error',
          error: parseErr instanceof Error ? parseErr.message : 'XML parse failed',
          suggestedFix: 'XML too malformed even after sanitization',
        }
      }
    }

    if (wasRedirected) {
      return {
        outlet,
        status: 'redirect',
        redirectUrl: finalUrl,
        itemCount,
        latestItemDate,
        suggestedFix: `Update rssUrl to: ${finalUrl}`,
      }
    }

    return {
      outlet,
      status: 'ok',
      itemCount,
      latestItemDate,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { outlet, status: 'timeout', error: `Timed out after ${RSS_TIMEOUT / 1000}s` }
    }
    const suggested = await tryAlternativeUrls(outlet)
    return {
      outlet,
      status: 'network_error',
      error: err instanceof Error ? err.message : 'Unknown network error',
      suggestedFix: suggested || undefined,
    }
  }
}

/** Try common alternative RSS URL patterns for a domain */
async function tryAlternativeUrls(outlet: OutletInfo): Promise<string | null> {
  const domain = outlet.domain.replace(/^www\./, '')
  const patterns = [
    `https://${domain}/feed`,
    `https://${domain}/rss`,
    `https://${domain}/feeds/all.rss.xml`,
    `https://${domain}/rss.xml`,
    `https://${domain}/feed.xml`,
    `https://${domain}/atom.xml`,
    `https://www.${domain}/feed`,
    `https://www.${domain}/rss`,
    `https://feeds.feedburner.com/${domain.split('.')[0]}`,
  ]

  for (const url of patterns) {
    if (url === outlet.rssUrl) continue
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      try {
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: BROWSER_HEADERS,
          redirect: 'follow',
        })
        if (resp.ok) {
          const text = await resp.text()
          if (text.includes('<rss') || text.includes('<feed') || text.includes('<channel')) {
            return url
          }
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch {
      // Skip
    }
  }
  return null
}

/** Sanitize common XML issues that break parsers */
function sanitizeXml(xml: string): string {
  return xml
    // Fix unencoded ampersands (but not already-encoded ones)
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;')
    // Remove control characters (except tab, newline, carriage return)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Fix common CDATA issues
    .replace(/]]>(?!<)/g, ']]&gt;')
}

async function main() {
  const withRss = outlets.filter(o => o.rssUrl)
  const withoutRss = outlets.filter(o => !o.rssUrl)

  console.log(`\n════════════════════════════════════════════════════════`)
  console.log(`  RSS FEED AUDIT — ${outlets.length} outlets, ${withRss.length} with RSS`)
  console.log(`════════════════════════════════════════════════════════\n`)

  if (withoutRss.length > 0) {
    console.log(`📭 ${withoutRss.length} outlets WITHOUT RSS:`)
    for (const o of withoutRss) {
      console.log(`   - ${o.name} (${o.domain}) [${o.region}]`)
    }
    console.log()
  }

  // Test feeds in batches of 20
  const results: FeedResult[] = []
  const BATCH_SIZE = 20

  for (let i = 0; i < withRss.length; i += BATCH_SIZE) {
    const batch = withRss.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(withRss.length / BATCH_SIZE)
    process.stdout.write(`\r  Testing batch ${batchNum}/${totalBatches} (${i + batch.length}/${withRss.length})...`)

    const batchResults = await Promise.all(batch.map(testFeed))
    results.push(...batchResults)
  }
  console.log('\n')

  // Categorize results
  const ok = results.filter(r => r.status === 'ok')
  const redirects = results.filter(r => r.status === 'redirect')
  const httpErrors = results.filter(r => r.status === 'http_error')
  const parseErrors = results.filter(r => r.status === 'parse_error')
  const timeouts = results.filter(r => r.status === 'timeout')
  const networkErrors = results.filter(r => r.status === 'network_error')

  // Summary
  console.log(`═══ RESULTS SUMMARY ═══\n`)
  console.log(`  ✅ OK:             ${ok.length}`)
  console.log(`  🔄 Redirect:       ${redirects.length}`)
  console.log(`  ❌ HTTP Error:      ${httpErrors.length}`)
  console.log(`  ⚠️  Parse Error:    ${parseErrors.length}`)
  console.log(`  ⏱️  Timeout:        ${timeouts.length}`)
  console.log(`  🔌 Network Error:  ${networkErrors.length}`)
  console.log(`  ─────────────────────`)
  console.log(`  Total:             ${results.length}`)
  console.log(`  Success Rate:      ${((ok.length + redirects.length) / results.length * 100).toFixed(1)}%\n`)

  // By region
  console.log(`═══ BY REGION ═══\n`)
  const byRegion = new Map<string, { total: number; ok: number; failed: number }>()
  for (const r of results) {
    const region = r.outlet.region
    if (!byRegion.has(region)) byRegion.set(region, { total: 0, ok: 0, failed: 0 })
    const entry = byRegion.get(region)!
    entry.total++
    if (r.status === 'ok' || r.status === 'redirect') entry.ok++
    else entry.failed++
  }
  for (const [region, stats] of Array.from(byRegion.entries()).sort((a, b) => b[1].failed - a[1].failed)) {
    const pct = (stats.ok / stats.total * 100).toFixed(0)
    console.log(`  ${region}: ${stats.ok}/${stats.total} ok (${pct}%) — ${stats.failed} failed`)
  }

  // Detail: HTTP errors
  if (httpErrors.length > 0) {
    console.log(`\n═══ HTTP ERRORS ═══\n`)
    for (const r of httpErrors.sort((a, b) => (a.httpStatus || 0) - (b.httpStatus || 0))) {
      console.log(`  ${r.httpStatus} — ${r.outlet.name} (${r.outlet.region})`)
      console.log(`       URL: ${r.outlet.rssUrl}`)
      if (r.suggestedFix) console.log(`       💡 Fix: ${r.suggestedFix}`)
    }
  }

  // Detail: Parse errors
  if (parseErrors.length > 0) {
    console.log(`\n═══ PARSE ERRORS ═══\n`)
    for (const r of parseErrors) {
      console.log(`  ${r.outlet.name} (${r.outlet.region}): ${r.error}`)
      console.log(`       URL: ${r.outlet.rssUrl}`)
      if (r.suggestedFix) console.log(`       💡 Fix: ${r.suggestedFix}`)
    }
  }

  // Detail: Timeouts
  if (timeouts.length > 0) {
    console.log(`\n═══ TIMEOUTS ═══\n`)
    for (const r of timeouts) {
      console.log(`  ${r.outlet.name} (${r.outlet.region}): ${r.outlet.rssUrl}`)
      if (r.suggestedFix) console.log(`       💡 Fix: ${r.suggestedFix}`)
    }
  }

  // Detail: Network errors
  if (networkErrors.length > 0) {
    console.log(`\n═══ NETWORK ERRORS ═══\n`)
    for (const r of networkErrors) {
      console.log(`  ${r.outlet.name} (${r.outlet.region}): ${r.error}`)
      console.log(`       URL: ${r.outlet.rssUrl}`)
      if (r.suggestedFix) console.log(`       💡 Fix: ${r.suggestedFix}`)
    }
  }

  // Detail: Redirects with fix suggestions
  if (redirects.length > 0) {
    console.log(`\n═══ REDIRECTS (auto-fixable) ═══\n`)
    for (const r of redirects) {
      console.log(`  ${r.outlet.name}: ${r.outlet.rssUrl}`)
      console.log(`       → ${r.redirectUrl} (${r.itemCount} items)`)
    }
  }

  // Feeds with suggested fixes
  const fixable = results.filter(r => r.suggestedFix && r.status !== 'ok')
  if (fixable.length > 0) {
    console.log(`\n═══ SUGGESTED URL UPDATES ═══\n`)
    for (const r of fixable) {
      if (r.suggestedFix?.startsWith('http') || r.suggestedFix?.startsWith('Update')) {
        console.log(`  ${r.outlet.name}: ${r.suggestedFix}`)
      }
    }
  }

  // Stale feeds (last item > 7 days old)
  const staleDays = 7
  const stale = ok.filter(r => {
    if (!r.latestItemDate) return false
    const age = Date.now() - new Date(r.latestItemDate).getTime()
    return age > staleDays * 24 * 60 * 60 * 1000
  })
  if (stale.length > 0) {
    console.log(`\n═══ STALE FEEDS (last item > ${staleDays} days old) ═══\n`)
    for (const r of stale) {
      const daysOld = Math.floor((Date.now() - new Date(r.latestItemDate!).getTime()) / (1000 * 60 * 60 * 24))
      console.log(`  ${r.outlet.name}: last item ${daysOld} days ago (${r.latestItemDate})`)
    }
  }

  console.log(`\n════════════════════════════════════════════════════════`)
  console.log(`  AUDIT COMPLETE`)
  console.log(`════════════════════════════════════════════════════════\n`)
}

main().catch(console.error)
