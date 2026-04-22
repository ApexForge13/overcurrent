/**
 * CoinGecko — cryptocurrency price movement.
 *
 * ── Environment Variables: None (public tier no key).
 * ── Cost: Free.
 * ── What: Pulls 30-day price series for BTC + ETH + top stablecoins.
 *    Flags divergence when the narrative frames a crypto market event
 *    (crash, rally, depeg) in a way the price data contradicts.
 *
 * Crypto is the Phase-6 free fallback for financial_crypto. Polygon.io
 * crypto (Phase 8) is the premium fallback — code-pathed so a configured
 * Polygon key takes precedence.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 15_000
const API_BASE = 'https://api.coingecko.com/api/v3'
const COINS = ['bitcoin', 'ethereum', 'tether', 'usd-coin'] as const

interface Reading {
  coin: string
  date: string
  priceUsd: number
}

async function fetchHistory(coin: string): Promise<Reading[]> {
  const url = `${API_BASE}/coins/${coin}/market_chart?vs_currency=usd&days=30&interval=daily`
  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data = (await res.json()) as { prices?: Array<[number, number]> }
    return (data.prices ?? []).map(([t, p]) => ({
      coin,
      date: new Date(t).toISOString().split('T')[0],
      priceUsd: p,
    }))
  } catch (err) {
    console.warn(`[raw-signals/coingecko] ${coin} fetch failed:`, err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess cryptocurrency price history against a news story.
Given 30-day price series for BTC, ETH, and major stablecoins, return:
- volatileMove: true if BTC/ETH moved >15% or a stablecoin materially depegged in the window
- narrativeGap: true if the story frames the crypto market in a way the data contradicts
- description: 1-2 sentences or empty
Return JSON only:
{ "volatileMove": false, "narrativeGap": false, "description": "" }`

export const coinGeckoRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const readings: Reading[] = []
  for (const coin of COINS) {
    const series = await fetchHistory(coin)
    readings.push(...series)
  }
  if (readings.length === 0) {
    return {
      rawContent: { note: 'CoinGecko unreachable or empty' },
      haikuSummary: 'No CoinGecko data retrieved.',
      signalSource: 'coingecko', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  // Summarize per-coin first/last/min/max so the Haiku prompt is compact
  const summary: Array<{ coin: string; first: number; last: number; pctChange: string; min: number; max: number }> = []
  for (const coin of COINS) {
    const ser = readings.filter((r) => r.coin === coin).sort((a, b) => a.date.localeCompare(b.date))
    if (ser.length === 0) continue
    const first = ser[0].priceUsd
    const last = ser[ser.length - 1].priceUsd
    const prices = ser.map((r) => r.priceUsd)
    summary.push({
      coin,
      first,
      last,
      pctChange: (((last - first) / first) * 100).toFixed(2),
      min: Math.min(...prices),
      max: Math.max(...prices),
    })
  }

  let assessment = { volatileMove: false, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nCrypto 30-day summary:\n${summary.map((s, i) => `${i + 1}. ${s.coin} | first=$${s.first.toFixed(2)} | last=$${s.last.toFixed(2)} | ${s.pctChange}% | min=$${s.min.toFixed(2)} | max=$${s.max.toFixed(2)}`).join('\n')}`,
      agentType: 'raw_signal_coingecko', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/coingecko] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { summary, assessment, haikuCostUsd: haikuCost },
    haikuSummary: assessment.volatileMove ? 'Volatile crypto move in 30-day window' : 'Crypto stable through window',
    signalSource: 'coingecko', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: assessment.volatileMove ? 'medium' : 'low',
  }
}
