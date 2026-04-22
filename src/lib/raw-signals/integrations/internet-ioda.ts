/**
 * IODA (Internet Outage Detection & Analysis, Georgia Tech).
 *
 * ── Environment Variables: None.
 * ── Cost: Free.
 * ── What: IODA monitors BGP + active-probing + darknet signals and publishes
 *    a per-country outage API. Use it to confirm Cloudflare Radar findings
 *    from a second independent source, or detect outages Cloudflare missed.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2'

const COUNTRY_ISO2: Record<string, string> = {
  'United States': 'US', US: 'US', USA: 'US',
  China: 'CN', Russia: 'RU', Iran: 'IR', Israel: 'IL', Ukraine: 'UA',
  Germany: 'DE', 'United Kingdom': 'GB', UK: 'GB',
  India: 'IN', Turkey: 'TR',
  Syria: 'SY', Iraq: 'IQ', Myanmar: 'MM', Venezuela: 'VE', Sudan: 'SD',
}

interface Alert {
  datasource: string
  fromTime: number
  untilTime: number | null
  level: string
}

function resolveCountries(entities: string[]): string[] {
  const out: string[] = []
  for (const e of entities) {
    const code = COUNTRY_ISO2[e]
    if (code && !out.includes(code)) out.push(code)
  }
  return out.slice(0, 2)
}

async function fetchAlerts(iso2: string, since: Date): Promise<Alert[]> {
  const from = Math.floor((since.getTime() - 48 * 60 * 60 * 1000) / 1000)
  const until = Math.floor(since.getTime() / 1000)
  try {
    const url = `${API_BASE}/alerts?entityType=country&entityCode=${iso2}&from=${from}&until=${until}`
    const res = await fetchWithTimeout(url, TIMEOUT_MS, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).slice(0, 15).map((a) => ({
      datasource: String(a.datasource ?? ''),
      fromTime: typeof a.from === 'number' ? (a.from as number) : 0,
      untilTime: typeof a.until === 'number' ? (a.until as number) : null,
      level: String(a.level ?? ''),
    }))
  } catch (err) {
    console.warn(`[raw-signals/ioda] fetch failed for ${iso2}:`, err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess IODA internet outage alerts against a news story.
Given alerts for story-relevant countries in the 48h pre-story window, return:
- criticalAlerts: count of alerts with level "critical" or "warning"
- narrativeGap: true if alerts exist but the story doesn't mention outage/shutdown
- description: 1-2 sentences or empty
Return JSON only:
{ "criticalAlerts": 0, "narrativeGap": false, "description": "" }`

export const iodaRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const countries = resolveCountries(cluster.entities)
  if (countries.length === 0) {
    return {
      rawContent: { note: 'No known country entities' },
      haikuSummary: 'Skipped — no country match',
      signalSource: 'ioda-gatech', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const all: Array<{ country: string; alerts: Alert[] }> = []
  for (const c of countries) {
    const alerts = await fetchAlerts(c, cluster.firstDetectedAt)
    all.push({ country: c, alerts })
  }
  const totalAlerts = all.reduce((n, c) => n + c.alerts.length, 0)

  if (totalAlerts === 0) {
    return {
      rawContent: { countries, alerts: [] },
      haikuSummary: 'No IODA alerts for story countries in 48h window.',
      signalSource: 'ioda-gatech', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { criticalAlerts: 0, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nIODA alerts:\n${all.flatMap((c) => c.alerts.map((a) => `${c.country} | ${a.datasource} | level=${a.level}`)).slice(0, 15).join('\n')}`,
      agentType: 'raw_signal_ioda', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/ioda] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.narrativeGap && assessment.criticalAlerts > 0

  return {
    rawContent: { all, assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.criticalAlerts} critical IODA alerts across ${countries.length} countries`,
    signalSource: 'ioda-gatech', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.description : null,
    confidenceLevel: assessment.criticalAlerts >= 2 ? 'medium' : 'low',
  }
}
