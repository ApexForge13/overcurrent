/**
 * UN Security Council — meeting schedule & coverage RSS.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Fetches UN press.un.org RSS feed for Security Council coverage.
 *    Unusual or emergency meetings on story-relevant countries are an
 *    advance diplomatic signal — often preceding public-facing action.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const RSS_URL = 'https://press.un.org/en/rss/security-council'

interface Coverage {
  title: string
  pubDate: string
  link?: string
  description?: string
}

async function fetchCoverage(): Promise<Coverage[]> {
  try {
    const res = await fetchWithTimeout(RSS_URL, TIMEOUT_MS, {
      headers: { Accept: 'application/rss+xml,*/*' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/un-sc] HTTP ${res.status}`)
      return []
    }
    const text = await res.text()
    const out: Coverage[] = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(text)) !== null) {
      const block = m[1]
      const title = /<title>(?:<!\[CDATA\[)?([^<]+)(?:\]\]>)?<\/title>/.exec(block)?.[1]?.trim() ?? ''
      const pubDate = /<pubDate>([^<]+)<\/pubDate>/.exec(block)?.[1]?.trim() ?? ''
      const link = /<link>([^<]+)<\/link>/.exec(block)?.[1]?.trim() ?? ''
      const description = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim()
      out.push({ title, pubDate, link, description: description?.substring(0, 300) })
    }
    return out
  } catch (err) {
    console.warn('[raw-signals/un-sc] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess UN Security Council press coverage against a news story.
Given recent SC coverage items and the story's entities/regions, return:
- relevantItems: count of items clearly about the same country/event as the story
- emergencySignal: true if an emergency or unscheduled meeting is implied for a story-relevant country
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantItems": 0, "emergencySignal": false, "description": "" }`

export const unSecurityCouncilRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const items = await fetchCoverage()

  if (items.length === 0) {
    return {
      rawContent: { note: 'UN SC RSS unreachable' },
      haikuSummary: 'No UN Security Council coverage retrieved.',
      signalSource: 'un-security-council', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  // Keep only items published within the 14 days before the story
  const cutoff = cluster.firstDetectedAt.getTime() - 14 * 24 * 60 * 60 * 1000
  const recent = items.filter((i) => {
    const t = Date.parse(i.pubDate)
    return Number.isFinite(t) && t >= cutoff && t <= cluster.firstDetectedAt.getTime() + 7 * 24 * 60 * 60 * 1000
  })

  let assessment = { relevantItems: 0, emergencySignal: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nUN Security Council items (recent):\n${recent.slice(0, 10).map((c, i) => `${i + 1}. ${c.title} | ${c.pubDate}`).join('\n')}`,
      agentType: 'raw_signal_un_sc', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/un-sc] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { items: recent.slice(0, 10), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantItems} SC items relevant to story${assessment.emergencySignal ? ' (emergency signal)' : ''}`,
    signalSource: 'un-security-council', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.emergencySignal,
    divergenceDescription: assessment.emergencySignal ? assessment.description : null,
    confidenceLevel: assessment.emergencySignal ? 'medium' : 'low',
  }
}
