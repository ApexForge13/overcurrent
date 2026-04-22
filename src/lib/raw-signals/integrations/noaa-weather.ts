/**
 * NOAA Weather — active weather alerts via api.weather.gov.
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: Fetches active NWS alerts (tornadoes, hurricanes, flash floods,
 *    winter storms, heat) in the story's bounding box. Flags divergence
 *    when an extreme weather alert is directly relevant to the narrative
 *    but absent from coverage.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_URL = 'https://api.weather.gov/alerts/active'

interface Alert {
  event: string
  severity?: string
  headline?: string
  areaDesc?: string
  effective?: string
  expires?: string
}

async function fetchAlerts(bbox: { swLat: number; swLng: number; neLat: number; neLng: number } | null): Promise<Alert[]> {
  if (!bbox) return []
  const params = new URLSearchParams({
    status: 'actual',
    point: `${(bbox.swLat + bbox.neLat) / 2},${(bbox.swLng + bbox.neLng) / 2}`,
  })
  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'Overcurrent/1.0 connermhecht13@gmail.com' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/noaa] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { features?: Array<{ properties?: Record<string, unknown> }> }
    return (data.features ?? []).slice(0, 20).map((f) => {
      const p = f.properties ?? {}
      return {
        event: String(p.event ?? ''),
        severity: p.severity ? String(p.severity) : undefined,
        headline: p.headline ? String(p.headline) : undefined,
        areaDesc: p.areaDesc ? String(p.areaDesc) : undefined,
        effective: p.effective ? String(p.effective) : undefined,
        expires: p.expires ? String(p.expires) : undefined,
      }
    })
  } catch (err) {
    console.warn('[raw-signals/noaa] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess NWS active weather alerts against a news story.
Given alerts in the story's region and the story, return:
- relevantAlerts: count of alerts materially relevant to the story
- extremeAlerts: count with severity in Extreme/Severe
- narrativeGap: true if an extreme alert is directly relevant but unmentioned
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantAlerts": 0, "extremeAlerts": 0, "narrativeGap": false, "description": "" }`

export const noaaWeatherRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const alerts = await fetchAlerts(geo.boundingBox)

  if (alerts.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, alerts: [] },
      haikuSummary: 'No active NWS alerts in region.',
      signalSource: 'noaa-nws', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantAlerts: 0, extremeAlerts: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nActive alerts:\n${alerts.slice(0, 12).map((a, i) => `${i + 1}. ${a.event} | severity=${a.severity ?? '?'} | ${a.areaDesc ?? ''}`).join('\n')}`,
      agentType: 'raw_signal_noaa', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/noaa] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.extremeAlerts > 0

  return {
    rawContent: { alerts: alerts.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantAlerts} relevant alerts (${assessment.extremeAlerts} extreme)`,
    signalSource: 'noaa-nws', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.extremeAlerts >= 1 ? 'medium' : 'low',
  }
}
