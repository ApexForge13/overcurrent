/**
 * Sentinel Hub integration — optical (Sentinel-2) + SAR radar (Sentinel-1).
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   SENTINEL_HUB_CLIENT_ID     (required)
 *   SENTINEL_HUB_CLIENT_SECRET (required)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free tier: 30k processing units per month for catalog queries.
 * Each catalog search = ~1 processing unit (metadata only, no imagery rendered).
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Given a story's bounding box and timeframe, queries the STAC catalog
 * for Sentinel-2 L2A (optical) or Sentinel-1 GRD (SAR radar) tiles in the
 * 30-day window preceding firstDetectedAt.
 *
 * Returns tile metadata (timestamps, cloud cover %, polarization for SAR).
 * This is NOT raw imagery — we store tile IDs + metadata so the admin
 * dashboard can later fetch visuals if the signal looks significant.
 *
 * Haiku then assesses: did overhead imagery exist during/around the
 * claimed event? Sentinel-2 revisit is ~5 days at the equator; Sentinel-1
 * revisit is ~6 days per pass. Gaps > 6 days mean we cannot confirm.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'
import type { BoundingBox } from '../types'

const SH_TIMEOUT_MS = 25_000
const SH_OAUTH_URL = 'https://services.sentinel-hub.com/oauth/token'
const SH_CATALOG_URL = 'https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search'

// Token cache — OAuth tokens are valid for 1h; reuse across runner calls
let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.warn('[raw-signals/sentinel-hub] SENTINEL_HUB_CLIENT_ID or _SECRET not set')
    return null
  }

  // Return cached token if still valid (with 5min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    })

    const res = await fetchWithTimeout(SH_OAUTH_URL, SH_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      console.warn(`[raw-signals/sentinel-hub] OAuth HTTP ${res.status}`)
      return null
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) return null

    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    }
    return cachedToken.token
  } catch (err) {
    console.warn(
      '[raw-signals/sentinel-hub] OAuth failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

interface StacTile {
  id: string
  datetime: string
  cloudCover?: number
  // SAR-specific
  polarizations?: string[]
  orbitDirection?: string
  // Optical-specific
  productType?: string
}

async function searchCatalog(
  collection: 'sentinel-2-l2a' | 'sentinel-1-grd',
  bbox: BoundingBox,
  startDate: Date,
  endDate: Date,
  token: string,
): Promise<StacTile[]> {
  const query: Record<string, unknown> = {
    collections: [collection],
    bbox: [bbox.swLng, bbox.swLat, bbox.neLng, bbox.neLat],
    datetime: `${startDate.toISOString()}/${endDate.toISOString()}`,
    limit: 50,
  }

  // Optical-specific: filter by cloud cover if available
  if (collection === 'sentinel-2-l2a') {
    query.filter = { op: '<=', args: [{ property: 'eo:cloud_cover' }, 60] }
    query['filter-lang'] = 'cql2-json'
  }

  try {
    const res = await fetchWithTimeout(SH_CATALOG_URL, SH_TIMEOUT_MS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(query),
    })

    if (!res.ok) {
      console.warn(
        `[raw-signals/sentinel-hub] Catalog HTTP ${res.status} for ${collection}`,
      )
      return []
    }

    const data = (await res.json()) as {
      features?: Array<{
        id: string
        properties: Record<string, unknown>
      }>
    }

    const features = Array.isArray(data.features) ? data.features : []
    return features.map((f) => {
      const props = f.properties || {}
      return {
        id: f.id,
        datetime: String(props.datetime ?? ''),
        cloudCover:
          typeof props['eo:cloud_cover'] === 'number'
            ? (props['eo:cloud_cover'] as number)
            : undefined,
        polarizations: Array.isArray(props['sar:polarizations'])
          ? (props['sar:polarizations'] as string[])
          : undefined,
        orbitDirection:
          typeof props['sat:orbit_state'] === 'string'
            ? (props['sat:orbit_state'] as string)
            : undefined,
        productType:
          typeof props['s2:product_type'] === 'string'
            ? (props['s2:product_type'] as string)
            : undefined,
      }
    })
  } catch (err) {
    console.warn(
      '[raw-signals/sentinel-hub] Catalog query failed:',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

// ── Haiku assessment ─────────────────────────────────────────────────
const HAIKU_SYSTEM_PROMPT = `You assess satellite imagery availability against a news story's claims.

Given a story and a list of satellite tile captures (from Sentinel-2 optical or Sentinel-1 SAR radar) in the same region/timeframe, answer:
1. Were there satellite passes DURING the claimed event window?
2. Are there gaps that would prevent confirmation (e.g., >6 days between passes, >60% cloud cover for optical)?
3. Does the timing of available imagery corroborate or contradict the story?

Key facts:
- Sentinel-2 revisits every ~5 days at the equator, cloud cover limits usability
- Sentinel-1 SAR revisits every ~6 days per pass, not affected by clouds or darkness
- Below 2 tiles in the window, do NOT flag divergence — insufficient data

Return JSON only:
{
  "tileCount": number,
  "coverageSummary": "string (1 sentence)",
  "corroboratesNarrative": boolean,
  "addsMissingContext": boolean,
  "contextDescription": "string (1-2 sentences)"
}`

function buildRunner(
  collection: 'sentinel-2-l2a' | 'sentinel-1-grd',
  sensor: 'optical' | 'radar',
): IntegrationRunner {
  return async (ctx) => {
    const { cluster, signalType } = ctx

    const geo = await extractGeoForSignal(
      signalType,
      cluster.entities,
      cluster.headline,
      cluster.synopsis,
    )

    if (!geo.boundingBox) {
      return {
        rawContent: {
          query: { collection, note: 'No bounding box extracted' },
          tiles: [],
        },
        haikuSummary: `No geographic bounding box available for ${sensor} imagery query.`,
        signalSource: `sentinel-hub-${sensor}`,
        captureDate: new Date(),
        coordinates: null,
        divergenceFlag: false,
        divergenceDescription: null,
        confidenceLevel: 'low' as const,
      }
    }

    const token = await getAccessToken()
    if (!token) {
      return null // Integration skipped — creds missing or auth failed
    }

    // 30-day window centered on firstDetectedAt (15 days before, 15 days after)
    const endDate = new Date(cluster.firstDetectedAt.getTime() + 15 * 24 * 60 * 60 * 1000)
    const startDate = new Date(cluster.firstDetectedAt.getTime() - 15 * 24 * 60 * 60 * 1000)

    const tiles = await searchCatalog(collection, geo.boundingBox, startDate, endDate, token)

    if (tiles.length === 0) {
      return {
        rawContent: {
          query: {
            collection,
            bbox: geo.boundingBox,
            regionLabel: geo.regionLabel,
            window: { start: startDate.toISOString(), end: endDate.toISOString() },
          },
          tiles: [],
          note: 'No tiles found in region/timeframe',
        },
        haikuSummary: `No ${sensor} satellite tiles found in region/timeframe.`,
        signalSource: `sentinel-hub-${sensor}`,
        captureDate: cluster.firstDetectedAt,
        coordinates: geo.boundingBox,
        divergenceFlag: false,
        divergenceDescription: null,
        confidenceLevel: 'low' as const,
      }
    }

    // Haiku assessment
    const tileSample = tiles.slice(0, 20)
    const userPrompt = `Story headline: ${cluster.headline}

Story summary: ${cluster.synopsis.substring(0, 1200)}

Region: ${geo.regionLabel ?? 'unknown'}
Sensor: ${sensor === 'optical' ? 'Sentinel-2 L2A (optical, affected by clouds)' : 'Sentinel-1 GRD (SAR radar, all-weather)'}
Window: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (30 days centered on story break at ${cluster.firstDetectedAt.toISOString().split('T')[0]})

Satellite tiles captured:
${tileSample.map((t, i) => `${i + 1}. ${t.datetime}${sensor === 'optical' ? ` | cloud=${t.cloudCover ?? '?'}%` : ''}${sensor === 'radar' ? ` | pol=${(t.polarizations ?? []).join(',')} | orbit=${t.orbitDirection ?? '?'}` : ''}`).join('\n')}

Assess whether this imagery coverage supports/contradicts the narrative. Below 2 tiles, do NOT flag divergence.`

    let assessment
    let haikuCost = 0
    try {
      const result = await callClaude({
        model: HAIKU,
        systemPrompt: HAIKU_SYSTEM_PROMPT,
        userPrompt,
        agentType: `raw_signal_sentinel_${sensor}`,
        maxTokens: 600,
      })
      haikuCost = result.costUsd
      assessment = parseJSON<{
        tileCount: number
        coverageSummary: string
        corroboratesNarrative: boolean
        addsMissingContext: boolean
        contextDescription: string
      }>(result.text)
    } catch (err) {
      console.warn(
        `[raw-signals/sentinel-hub] Haiku assessment failed:`,
        err instanceof Error ? err.message : err,
      )
      assessment = {
        tileCount: tiles.length,
        coverageSummary: `${tiles.length} ${sensor} tiles captured; Haiku assessment failed`,
        corroboratesNarrative: false,
        addsMissingContext: false,
        contextDescription: '',
      }
    }

    const belowThreshold = tiles.length < 2
    const divergenceFlag = !belowThreshold && assessment.addsMissingContext
    const divergenceDescription = divergenceFlag ? assessment.contextDescription : null

    return {
      rawContent: {
        query: {
          collection,
          bbox: geo.boundingBox,
          regionLabel: geo.regionLabel,
          window: { start: startDate.toISOString(), end: endDate.toISOString() },
          haikuCostUsd: haikuCost,
        },
        tiles: tileSample,
        assessment,
      },
      haikuSummary:
        assessment.coverageSummary || `${tiles.length} ${sensor} tiles captured`,
      signalSource: `sentinel-hub-${sensor}`,
      captureDate: cluster.firstDetectedAt,
      coordinates: geo.boundingBox,
      divergenceFlag,
      divergenceDescription,
      confidenceLevel: belowThreshold ? 'low' : tiles.length >= 6 ? 'high' : 'medium',
    }
  }
}

export const sentinelOpticalRunner: IntegrationRunner = buildRunner(
  'sentinel-2-l2a',
  'optical',
)
export const sentinelRadarRunner: IntegrationRunner = buildRunner(
  'sentinel-1-grd',
  'radar',
)
