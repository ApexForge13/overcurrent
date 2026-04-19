/**
 * ProMED — unofficial disease surveillance via RSS.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Fetches ProMED's public RSS feed of unofficial disease reports.
 *    ProMED often breaks outbreak news days before WHO's formal DON posts —
 *    a ProMED hit for a story-relevant region is an earlier-signal complement
 *    to the WHO DON runner.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const RSS_URL = 'https://promedmail.org/api/v1/posts/rss/'

interface Report {
  title: string
  pubDate: string
  link?: string
  description?: string
}

async function fetchReports(): Promise<Report[]> {
  try {
    const res = await fetchWithTimeout(RSS_URL, TIMEOUT_MS, {
      headers: { Accept: 'application/rss+xml,*/*' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/promed] HTTP ${res.status}`)
      return []
    }
    const text = await res.text()
    const out: Report[] = []
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
    console.warn('[raw-signals/promed] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess ProMED informal disease reports against a news story.
Given recent ProMED entries and the story's entities/regions, return:
- relevantReports: count of reports clearly tied to story countries/entities
- leadTimeDays: rough days ProMED preceded any mainstream coverage of the outbreak (0 if unknown)
- materialOmission: true if a ProMED-reported outbreak is directly relevant and absent from the story
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantReports": 0, "leadTimeDays": 0, "materialOmission": false, "description": "" }`

export const promedRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const reports = await fetchReports()
  if (reports.length === 0) {
    return {
      rawContent: { note: 'ProMED RSS empty or unreachable' },
      haikuSummary: 'No ProMED reports retrieved.',
      signalSource: 'promed-mail', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const cutoff = cluster.firstDetectedAt.getTime() - 14 * 24 * 60 * 60 * 1000
  const recent = reports.filter((r) => {
    const t = Date.parse(r.pubDate)
    return Number.isFinite(t) && t >= cutoff
  })

  let assessment = { relevantReports: 0, leadTimeDays: 0, materialOmission: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nProMED reports:\n${recent.slice(0, 12).map((r, i) => `${i + 1}. ${r.title} | ${r.pubDate}`).join('\n')}`,
      agentType: 'raw_signal_promed', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/promed] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { reports: recent.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantReports} relevant ProMED reports (lead ~${assessment.leadTimeDays}d)`,
    signalSource: 'promed-mail', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.materialOmission,
    divergenceDescription: assessment.materialOmission ? assessment.description : null,
    confidenceLevel: assessment.leadTimeDays >= 3 ? 'medium' : 'low',
  }
}
