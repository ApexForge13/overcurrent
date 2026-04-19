/**
 * Cloudflare Radar — BGP anomalies + country-level traffic.
 *
 * ── Environment Variables: CLOUDFLARE_RADAR_TOKEN (required — free API token).
 * ── Cost: Free.
 * ── What: Queries Cloudflare Radar for country-level traffic changes in
 *    the last 48h. Traffic drops or BGP anomalies in a country the story
 *    is about — especially when the story doesn't reference a shutdown —
 *    is a strong divergence signal (censorship / outage indicator).
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_BASE = 'https://api.cloudflare.com/client/v4/radar/netflows/timeseries_groups'

const COUNTRY_ISO2: Record<string, string> = {
  'United States': 'US', US: 'US', USA: 'US',
  China: 'CN', Russia: 'RU', Iran: 'IR', Israel: 'IL', Ukraine: 'UA',
  Germany: 'DE', 'United Kingdom': 'GB', UK: 'GB',
  India: 'IN', Japan: 'JP', Turkey: 'TR', Mexico: 'MX', Brazil: 'BR',
  'South Korea': 'KR', 'North Korea': 'KP',
  'Saudi Arabia': 'SA', Egypt: 'EG', Syria: 'SY', Iraq: 'IQ',
  Venezuela: 'VE', Myanmar: 'MM', Sudan: 'SD',
}

interface CountryTraffic {
  country: string
  series: Array<{ t: string; v: number }>
}

function resolveCountries(entities: string[]): string[] {
  const out: string[] = []
  for (const e of entities) {
    const code = COUNTRY_ISO2[e]
    if (code && !out.includes(code)) out.push(code)
  }
  return out.slice(0, 2)
}

async function fetchTraffic(iso2s: string[]): Promise<CountryTraffic[]> {
  const token = process.env.CLOUDFLARE_RADAR_TOKEN
  if (!token) {
    console.warn('[raw-signals/cloudflare] CLOUDFLARE_RADAR_TOKEN missing — skipping')
    return []
  }
  const out: CountryTraffic[] = []
  for (const country of iso2s) {
    try {
      const params = new URLSearchParams({
        dateRange: '2d',
        location: country,
        format: 'JSON',
      })
      const res = await fetchWithTimeout(`${API_BASE}?${params}`, TIMEOUT_MS, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) continue
      const data = (await res.json()) as { result?: { serie_0?: { timestamps?: string[]; values?: number[] } } }
      const s = data.result?.serie_0
      if (s?.timestamps && s?.values) {
        out.push({
          country,
          series: s.timestamps.map((t, i) => ({ t, v: s.values![i] ?? 0 })),
        })
      }
    } catch (err) {
      console.warn(`[raw-signals/cloudflare] fetch failed for ${country}:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

const HAIKU_SYSTEM = `You assess Cloudflare Radar country-level traffic against a news story.
Given 48h traffic time-series and the story, return:
- anomalyDetected: true if traffic dropped materially (>30% vs recent baseline)
- narrativeGap: true if an anomaly exists but the story doesn't mention an outage/shutdown
- description: 1-2 sentences or empty
Return JSON only:
{ "anomalyDetected": false, "narrativeGap": false, "description": "" }`

export const cloudflareRadarRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const countries = resolveCountries(cluster.entities)
  if (countries.length === 0) {
    return {
      rawContent: { note: 'No known country entities' },
      haikuSummary: 'Skipped — no country match',
      signalSource: 'cloudflare-radar', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const traffic = await fetchTraffic(countries)
  if (traffic.length === 0) {
    return {
      rawContent: { countries, note: 'No traffic data returned' },
      haikuSummary: 'No Cloudflare traffic data for story countries.',
      signalSource: 'cloudflare-radar', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { anomalyDetected: false, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const summary = traffic.map((t) => {
      const values = t.series.map((s) => s.v)
      const first = values.slice(0, Math.floor(values.length / 2))
      const last = values.slice(Math.floor(values.length / 2))
      const firstAvg = first.length > 0 ? first.reduce((a, b) => a + b, 0) / first.length : 0
      const lastAvg = last.length > 0 ? last.reduce((a, b) => a + b, 0) / last.length : 0
      const pctChange = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0
      return { country: t.country, pctChange: pctChange.toFixed(1) }
    })
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nCountry traffic change (first-half vs second-half of 48h window):\n${summary.map((s, i) => `${i + 1}. ${s.country}: ${s.pctChange}%`).join('\n')}`,
      agentType: 'raw_signal_cloudflare', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/cloudflare] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { traffic, assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.anomalyDetected ? 'Traffic anomaly detected' : 'Traffic within normal range',
    signalSource: 'cloudflare-radar', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: assessment.anomalyDetected ? 'medium' : 'low',
  }
}
