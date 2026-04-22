import { describe, it, expect } from 'vitest'
import { parseRssXml, parsePubDate } from '@/lib/gap-score/narrative/rss-poller'

describe('RSS parser', () => {
  it('parseRssXml extracts items from RSS 2.0 format', () => {
    const xml = `
      <rss version="2.0"><channel>
        <item>
          <title>AAPL beats consensus</title>
          <link>https://example.test/a1</link>
          <pubDate>Mon, 20 Apr 2026 09:15:00 GMT</pubDate>
        </item>
        <item>
          <title>TSLA falls on production miss</title>
          <link>https://example.test/a2</link>
          <pubDate>Mon, 20 Apr 2026 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `
    const items = parseRssXml(xml)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('AAPL beats consensus')
    expect(items[0].url).toBe('https://example.test/a1')
    expect(items[1].title).toBe('TSLA falls on production miss')
  })

  it('parseRssXml extracts items from Atom format', () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>AAPL surges</title>
          <link href="https://example.test/a1"/>
          <updated>2026-04-20T09:15:00Z</updated>
        </entry>
      </feed>
    `
    const items = parseRssXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('AAPL surges')
    expect(items[0].url).toBe('https://example.test/a1')
  })

  it('parseRssXml handles CDATA-wrapped titles', () => {
    const xml = `
      <rss><channel>
        <item>
          <title><![CDATA[Breaking: AAPL & TSLA diverge]]></title>
          <link>https://example.test/a1</link>
          <pubDate>Mon, 20 Apr 2026 09:15:00 GMT</pubDate>
        </item>
      </channel></rss>
    `
    const items = parseRssXml(xml)
    expect(items[0].title).toBe('Breaking: AAPL & TSLA diverge')
  })

  it('parseRssXml returns [] for empty or malformed input', () => {
    expect(parseRssXml('')).toEqual([])
    expect(parseRssXml('not-xml')).toEqual([])
  })

  it('parsePubDate returns Date for valid input, now() for invalid', () => {
    const d = parsePubDate('Mon, 20 Apr 2026 09:15:00 GMT')
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(3) // April
    const fallback = parsePubDate('garbage')
    expect(fallback).toBeInstanceOf(Date)
  })
})
