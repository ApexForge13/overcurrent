/**
 * Container shipping rates — Freightos Baltic Index (FBX).
 *
 * ── Environment Variables: FREIGHTOS_API_KEY (optional — public endpoint
 *    gives daily FBX without auth; paid tiers unlock per-lane granularity.)
 * ── Cost: Free tier.
 * ── What: Fetches the headline FBX daily index value from Freightos's
 *    public endpoint. Flags divergence when the narrative claims a
 *    shipping squeeze/collapse unsupported by the index move.
 *
 *    Freightos also publishes lane-specific sub-indices (FBX01 China→NA
 *    West Coast, FBX11 Europe→Med, etc.) — wired into Phase 10 backfill.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_URL = 'https://fbx.freightos.com/api/public/fbx'

interface Reading {
  date: string
  indexValue: number | null
}

async function fetchFbx(): Promise<Reading[]> {
  try {
    const res = await fetchWithTimeout(API_URL, TIMEOUT_MS, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).slice(-14).map((r) => ({
      date: String(r.date ?? ''),
      indexValue: typeof r.value === 'number' ? (r.value as number) : r.value ? parseFloat(String(r.value)) : null,
    }))
  } catch (err) {
    console.warn('[raw-signals/shipping-rates] fetch failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess container shipping rates (FBX index) against a news story on trade/supply.
Given the recent 14-day FBX series and the story, return:
- directionMatch: true if rate movement aligns with the narrative's framing of shipping conditions
- narrativeGap: true if rates contradict the framing
- description: 1-2 sentences or empty
Return JSON only:
{ "directionMatch": true, "narrativeGap": false, "description": "" }`

export const shippingRatesRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const readings = await fetchFbx()
  if (readings.length === 0) {
    return {
      rawContent: { note: 'FBX public endpoint unreachable or empty' },
      haikuSummary: 'Skipped — no FBX data',
      signalSource: 'freightos-fbx', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { directionMatch: true, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nFBX daily (last 14):\n${readings.map((r, i) => `${i + 1}. ${r.date} | ${r.indexValue ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_shipping_rates', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/shipping-rates] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { readings, assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.narrativeGap ? 'FBX contradicts narrative framing' : 'FBX consistent with narrative',
    signalSource: 'freightos-fbx', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: 'low' as const,
  }
}
