/**
 * Copernicus Emergency Management Service (CEMS) — activations.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Fetches the list of active CEMS rapid-mapping activations from
 *    emergency.copernicus.eu. An active CEMS activation on a country or
 *    region named in the story is independent confirmation of a serious
 *    humanitarian/disaster event — absence of a reference to an active
 *    activation in coverage is a meaningful gap.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
// CEMS rapid-mapping activation list — ATOM feed
const FEED_URL = 'https://emergency.copernicus.eu/mapping/list-of-activations-rapid'

interface Activation {
  activationId: string
  title: string
  countryIso?: string
  type?: string
  activationDate?: string
  link?: string
}

async function fetchActivations(): Promise<Activation[]> {
  try {
    const res = await fetchWithTimeout(FEED_URL, TIMEOUT_MS, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) return []
    const html = await res.text()
    // Scrape activation rows — CEMS renders each as a .view-row
    const out: Activation[] = []
    const rowRe = /<article[^>]*class="[^"]*node--type-activation[^"]*"[^>]*>([\s\S]*?)<\/article>/g
    let m: RegExpExecArray | null
    while ((m = rowRe.exec(html)) !== null) {
      const block = m[1]
      const activationId = /EMSR\d+/.exec(block)?.[0] ?? ''
      const title = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
      const type = /Type of Event:\s*([^<]+)/i.exec(block)?.[1]?.trim()
      const activationDate = /Activation Date:\s*([^<]+)/i.exec(block)?.[1]?.trim()
      const link = /<a[^>]*href="([^"]*activations\/[^"]+)"/.exec(block)?.[1]
      if (activationId) {
        out.push({ activationId, title, type, activationDate, link })
      }
    }
    return out.slice(0, 30)
  } catch (err) {
    console.warn('[raw-signals/copernicus] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess Copernicus Emergency Management activations against a news story.
Given active CEMS activations and the story's entities/regions, return:
- relevantActivations: count of activations for countries/regions named in the story
- activationOmitted: true if an active CEMS activation is directly relevant but unreferenced
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantActivations": 0, "activationOmitted": false, "description": "" }`

export const copernicusEmergencyRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const activations = await fetchActivations()
  if (activations.length === 0) {
    return {
      rawContent: { note: 'CEMS feed unreachable or empty' },
      haikuSummary: 'No CEMS activations retrieved.',
      signalSource: 'copernicus-ems', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantActivations: 0, activationOmitted: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nActivations:\n${activations.slice(0, 15).map((a, i) => `${i + 1}. ${a.activationId} | ${a.title} | ${a.type ?? '?'} | ${a.activationDate ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_copernicus', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/copernicus] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { activations: activations.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantActivations} relevant CEMS activations`,
    signalSource: 'copernicus-ems', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.activationOmitted,
    divergenceDescription: assessment.activationOmitted ? assessment.description : null,
    confidenceLevel: assessment.relevantActivations >= 1 ? 'medium' : 'low',
  }
}
