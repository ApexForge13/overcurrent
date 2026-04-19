/**
 * US State Department travel advisories — RSS feed.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Fetches the State Dept TA-by-issuance-date RSS feed and checks
 *    whether any advisory touches a country named in the story's entities.
 *    Level changes (Level 3+ = Reconsider/Do Not Travel) are the
 *    material finding — below that, advisory updates are noise.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const RSS_URL = 'https://travel.state.gov/_res/rss/TAsByIssuanceDate.xml'

interface Advisory {
  country: string
  level: number | null
  title: string
  pubDate: string
  summary?: string
  link?: string
}

function parseLevelFromTitle(title: string): number | null {
  const m = /Level\s+(\d)/i.exec(title)
  return m ? parseInt(m[1], 10) : null
}

function extractCountryFromTitle(title: string): string {
  return title.replace(/Level\s+\d[^-]*-\s*/i, '').replace(/\s+Travel Advisory\s*$/i, '').trim()
}

async function fetchAdvisories(): Promise<Advisory[]> {
  try {
    const res = await fetchWithTimeout(RSS_URL, TIMEOUT_MS, {
      headers: { Accept: 'application/xml,text/xml,*/*' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/travel-advisory-us] HTTP ${res.status}`)
      return []
    }
    const text = await res.text()
    const items: Advisory[] = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let match: RegExpExecArray | null
    while ((match = itemRe.exec(text)) !== null) {
      const block = match[1]
      const title = /<title>(?:<!\[CDATA\[)?([^<]+)(?:\]\]>)?<\/title>/.exec(block)?.[1]?.trim() ?? ''
      const pubDate = /<pubDate>([^<]+)<\/pubDate>/.exec(block)?.[1]?.trim() ?? ''
      const link = /<link>([^<]+)<\/link>/.exec(block)?.[1]?.trim() ?? ''
      const description = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(block)?.[1]
      items.push({
        country: extractCountryFromTitle(title),
        level: parseLevelFromTitle(title),
        title,
        pubDate,
        summary: description?.replace(/<[^>]+>/g, '').substring(0, 300),
        link,
      })
    }
    return items
  } catch (err) {
    console.warn('[raw-signals/travel-advisory-us] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess US travel advisories against a news story.
Given advisories and the story's entities/regions, return:
- relevantAdvisories: count of advisories that match countries named in the story
- maxLevel: the highest advisory level across relevant advisories (1-4, or null)
- levelChangeOmitted: true if a Level 3+ advisory is directly relevant but unreferenced in the story
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantAdvisories": 0, "maxLevel": null, "levelChangeOmitted": false, "description": "" }`

export const travelAdvisoryUsRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const advisories = await fetchAdvisories()

  if (advisories.length === 0) {
    return {
      rawContent: { note: 'RSS fetch failed or empty' },
      haikuSummary: 'No US travel advisories retrieved.',
      signalSource: 'us-state-travel-advisories', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  // Pre-filter: keep advisories where the country name appears in any cluster entity
  const entitiesLower = cluster.entities.map((e) => e.toLowerCase())
  const candidates = advisories.filter((a) =>
    a.country && entitiesLower.some((ent) => ent.includes(a.country.toLowerCase()) || a.country.toLowerCase().includes(ent)),
  )

  if (candidates.length === 0) {
    return {
      rawContent: { advisoryCountInFeed: advisories.length, candidates: [] },
      haikuSummary: `${advisories.length} advisories in feed, none match story countries.`,
      signalSource: 'us-state-travel-advisories', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantAdvisories: 0, maxLevel: null as number | null, levelChangeOmitted: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nAdvisories matching story countries:\n${candidates.slice(0, 10).map((a, i) => `${i + 1}. ${a.country} | Level ${a.level ?? '?'} | ${a.pubDate}`).join('\n')}`,
      agentType: 'raw_signal_travel_us', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/travel-advisory-us] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = (assessment.maxLevel ?? 0) >= 3 && assessment.levelChangeOmitted

  return {
    rawContent: { candidates: candidates.slice(0, 10), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantAdvisories} relevant advisories (max Level ${assessment.maxLevel ?? 'n/a'})`,
    signalSource: 'us-state-travel-advisories', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: (assessment.maxLevel ?? 0) >= 4 ? 'high' : (assessment.maxLevel ?? 0) >= 3 ? 'medium' : 'low',
  }
}
