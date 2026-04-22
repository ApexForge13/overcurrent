/**
 * RSS narrative poller.
 *
 * Directly fetches RSS feeds from a curated set of financial + general
 * news outlets, extracts entities from article titles, writes
 * EntityObservation rows with sourceType='rss_article'.
 *
 * Why a separate minimal fetcher instead of reusing scanRssFeeds():
 *   - scanRssFeeds is built for cluster-driven keyword matching (articles
 *     must match anchor + context words from a query). Our narrative
 *     poller wants broad ingestion — filter by entity presence in our
 *     alias index, not by a text query.
 *   - Simpler error handling for the background polling context.
 *
 * For 1c.2b.1 scope: 10 curated outlets. Expand post-validation.
 */

import type { PrismaClient } from '@prisma/client'
import { fetchWithTimeout } from '@/lib/utils'
import { getAliasIndex } from '@/lib/entity-extraction/alias-index'
import { extractEntities } from '@/lib/entity-extraction/extract-from-text'
import { writeObservations, type ObservationInput } from './observation-writer'

const SOURCE_TYPE = 'rss_article'
const RSS_TIMEOUT_MS = 12_000
const MAX_ITEMS_PER_FEED = 50

/**
 * Curated feed list. Focused on financial + macro + wire. Biased toward
 * high-signal outlets that index heavily in GDELT too (some redundancy
 * is fine — dedup is by sourceUrl).
 */
export const RSS_FEEDS: ReadonlyArray<{ outlet: string; url: string }> = Object.freeze([
  { outlet: 'reuters.com', url: 'https://feeds.reuters.com/reuters/businessNews' },
  { outlet: 'bloomberg.com', url: 'https://feeds.bloomberg.com/markets/news.rss' },
  { outlet: 'wsj.com', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
  { outlet: 'ft.com', url: 'https://www.ft.com/markets?format=rss' },
  { outlet: 'cnbc.com', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { outlet: 'marketwatch.com', url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
  { outlet: 'seekingalpha.com', url: 'https://seekingalpha.com/market_currents.xml' },
  { outlet: 'finance.yahoo.com', url: 'https://finance.yahoo.com/news/rssindex' },
  { outlet: 'barrons.com', url: 'https://www.barrons.com/feed/rssheadlines' },
  { outlet: 'economist.com', url: 'https://www.economist.com/finance-and-economics/rss.xml' },
])

export interface RssPollResult {
  feedCount: number
  itemsFetched: number
  observationsAttempted: number
  observationsInserted: number
  unmatchedItems: number
  feedErrors: number
}

interface RssItem {
  title: string
  url: string
  publishedAt: string | null
}

/**
 * Minimal RSS/Atom parser. Extracts title + link + pubDate from items.
 * No external dep — regex parse covers the 90% case for well-formed feeds.
 * Malformed feeds get 0 items (non-fatal).
 */
export function parseRssXml(xml: string, max = MAX_ITEMS_PER_FEED): RssItem[] {
  if (!xml) return []
  const items: RssItem[] = []

  // RSS 2.0: <item>...<title>..</title>...<link>..</link>...<pubDate>..</pubDate>
  const itemBlockRe = /<item\b[\s\S]*?<\/item>/gi
  const atomEntryRe = /<entry\b[\s\S]*?<\/entry>/gi

  const process = (block: string) => {
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link') || extractAttr(block, 'link', 'href')
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    if (!title || !link) return
    items.push({
      title: stripCdataAndTags(title),
      url: stripCdataAndTags(link),
      publishedAt: pubDate ? stripCdataAndTags(pubDate) : null,
    })
  }

  let m: RegExpExecArray | null
  while ((m = itemBlockRe.exec(xml)) !== null && items.length < max) {
    process(m[0])
  }
  if (items.length < max) {
    while ((m = atomEntryRe.exec(xml)) !== null && items.length < max) {
      process(m[0])
    }
  }
  return items
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = block.match(re)
  return m ? m[1].trim() : ''
}

function extractAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]+)"`, 'i')
  const m = block.match(re)
  return m ? m[1] : ''
}

function stripCdataAndTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
}

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, RSS_TIMEOUT_MS, {
      headers: { 'User-Agent': 'Overcurrent/1.0' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Poll all curated RSS feeds once. Parse → extract → write.
 */
export async function pollRssFeeds(prisma: PrismaClient): Promise<RssPollResult> {
  const aliasIndex = await getAliasIndex(prisma)
  let itemsFetched = 0
  let unmatchedItems = 0
  let feedErrors = 0
  const observations: ObservationInput[] = []

  for (const feed of RSS_FEEDS) {
    const xml = await fetchFeed(feed.url)
    if (!xml) {
      feedErrors++
      continue
    }
    const items = parseRssXml(xml)
    itemsFetched += items.length
    for (const item of items) {
      const hits = extractEntities(item.title, aliasIndex)
      if (hits.length === 0) {
        unmatchedItems++
        continue
      }
      const observedAt = parsePubDate(item.publishedAt)
      for (const h of hits) {
        observations.push({
          entityId: h.entityId,
          sourceType: SOURCE_TYPE,
          outlet: feed.outlet,
          sourceUrl: item.url,
          title: item.title,
          engagement: null,
          observedAt,
        })
      }
    }
  }

  const writeResult = await writeObservations(prisma, observations)
  return {
    feedCount: RSS_FEEDS.length,
    itemsFetched,
    observationsAttempted: writeResult.attempted,
    observationsInserted: writeResult.inserted,
    unmatchedItems,
    feedErrors,
  }
}

export function parsePubDate(raw: string | null): Date {
  if (!raw) return new Date()
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d : new Date()
}
