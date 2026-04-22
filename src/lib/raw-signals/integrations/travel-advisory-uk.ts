/**
 * UK FCDO travel advice — Atom feed.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Fetches the FCDO foreign travel advice Atom feed for recent
 *    updates and checks whether any touch a country named in the story.
 *    Divergence flagged when the UK assessment materially diverges from
 *    the narrative — particularly important on UK- or Europe-framed stories
 *    where the US advisory may not exist or may read differently.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const ATOM_URL = 'https://www.gov.uk/foreign-travel-advice.atom'

interface Entry {
  country: string
  title: string
  updated: string
  summary?: string
  link?: string
}

async function fetchAdvisories(): Promise<Entry[]> {
  try {
    const res = await fetchWithTimeout(ATOM_URL, TIMEOUT_MS, {
      headers: { Accept: 'application/atom+xml,*/*' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/travel-advisory-uk] HTTP ${res.status}`)
      return []
    }
    const text = await res.text()
    const entries: Entry[] = []
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g
    let m: RegExpExecArray | null
    while ((m = entryRe.exec(text)) !== null) {
      const block = m[1]
      const title = /<title>([^<]+)<\/title>/.exec(block)?.[1]?.trim() ?? ''
      const updated = /<updated>([^<]+)<\/updated>/.exec(block)?.[1]?.trim() ?? ''
      const link = /<link[^>]*href="([^"]+)"/.exec(block)?.[1]?.trim() ?? ''
      const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim()
      // Title is usually just the country name ("France", "Iran", etc.)
      entries.push({ country: title, title, updated, summary: summary?.substring(0, 300), link })
    }
    return entries
  } catch (err) {
    console.warn('[raw-signals/travel-advisory-uk] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess UK FCDO travel advice against a news story.
Given recent advisory updates and the story's entities/regions, return:
- relevantAdvisories: count matching countries named in the story
- materialUpdate: true if an updated UK advisory is directly relevant and NOT referenced in the story
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantAdvisories": 0, "materialUpdate": false, "description": "" }`

export const travelAdvisoryUkRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const entries = await fetchAdvisories()

  if (entries.length === 0) {
    return {
      rawContent: { note: 'Atom feed unreachable or empty' },
      haikuSummary: 'No UK FCDO entries retrieved.',
      signalSource: 'uk-fcdo-travel', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const entitiesLower = cluster.entities.map((e) => e.toLowerCase())
  const candidates = entries.filter((e) =>
    e.country && entitiesLower.some((ent) => ent.includes(e.country.toLowerCase()) || e.country.toLowerCase().includes(ent)),
  )

  if (candidates.length === 0) {
    return {
      rawContent: { feedEntryCount: entries.length, candidates: [] },
      haikuSummary: `${entries.length} FCDO entries, none match story countries.`,
      signalSource: 'uk-fcdo-travel', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantAdvisories: 0, materialUpdate: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nFCDO entries:\n${candidates.slice(0, 10).map((e, i) => `${i + 1}. ${e.country} | updated ${e.updated}`).join('\n')}`,
      agentType: 'raw_signal_travel_uk', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/travel-advisory-uk] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.materialUpdate

  return {
    rawContent: { candidates: candidates.slice(0, 10), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantAdvisories} FCDO advisories for story countries`,
    signalSource: 'uk-fcdo-travel', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.materialUpdate ? 'medium' : 'low',
  }
}
