/**
 * WHO — Disease Outbreak News (DONs) via RSS.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Fetches the WHO Disease Outbreak News RSS feed and checks for
 *    entries tied to countries named in the story. An outbreak in a
 *    story-relevant country unmentioned by the coverage is a material
 *    gap — particularly for civil-unrest or displacement narratives.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const RSS_URL = 'https://www.who.int/feeds/entity/csr/don/en/rss.xml'

interface Outbreak {
  title: string
  pubDate: string
  link?: string
  description?: string
}

async function fetchOutbreaks(): Promise<Outbreak[]> {
  try {
    const res = await fetchWithTimeout(RSS_URL, TIMEOUT_MS, {
      headers: { Accept: 'application/rss+xml,*/*' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/who] HTTP ${res.status}`)
      return []
    }
    const text = await res.text()
    const out: Outbreak[] = []
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
    console.warn('[raw-signals/who] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess WHO Disease Outbreak News entries against a news story.
Given recent outbreak entries and the story's entities/regions, return:
- relevantOutbreaks: count of outbreaks affecting countries in the story
- materialOmission: true if an outbreak is directly relevant but absent from the story
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantOutbreaks": 0, "materialOmission": false, "description": "" }`

export const whoDiseaseRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const outbreaks = await fetchOutbreaks()
  if (outbreaks.length === 0) {
    return {
      rawContent: { note: 'WHO RSS empty or unreachable' },
      haikuSummary: 'No WHO Disease Outbreak entries retrieved.',
      signalSource: 'who-dons', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  // Keep entries within the 90 days before the story (outbreaks often linger)
  const cutoff = cluster.firstDetectedAt.getTime() - 90 * 24 * 60 * 60 * 1000
  const recent = outbreaks.filter((o) => {
    const t = Date.parse(o.pubDate)
    return Number.isFinite(t) && t >= cutoff
  })

  let assessment = { relevantOutbreaks: 0, materialOmission: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nWHO outbreak entries:\n${recent.slice(0, 12).map((o, i) => `${i + 1}. ${o.title} | ${o.pubDate}`).join('\n')}`,
      agentType: 'raw_signal_who', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/who] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { entries: recent.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantOutbreaks} relevant WHO outbreak entries`,
    signalSource: 'who-dons', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.materialOmission,
    divergenceDescription: assessment.materialOmission ? assessment.description : null,
    confidenceLevel: assessment.relevantOutbreaks >= 2 ? 'medium' : 'low',
  }
}
