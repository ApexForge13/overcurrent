/**
 * NASA Earthdata — nasa_earthdata (CMR granule search).
 *
 * ── Environment Variables: NASA_EARTHDATA_USERNAME + NASA_EARTHDATA_PASSWORD
 *    (optional for search, required for granule download).
 * ── Cost: Free.
 * ── What: Searches NASA's Common Metadata Repository (CMR) for MODIS +
 *    VIIRS land cover / land surface change granules intersecting the
 *    story's bounding box and 30-day window. Returns granule metadata
 *    (timestamp, collection, day/night, cloud flag). Haiku assesses
 *    whether recent imagery coincides with the claimed event and
 *    flags material gaps.
 *
 *    Search endpoint is public; auth only needed for actual granule
 *    downloads (which we defer to Phase 10 backfill). For Phase 7 we
 *    capture granule metadata to document overhead coverage availability.
 *
 * Register free URS account at: https://urs.earthdata.nasa.gov/
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'
import type { BoundingBox } from '../types'

const TIMEOUT_MS = 20_000
const CMR_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json'

// Collections we care about for land-surface change:
//   MOD09GA — MODIS Terra surface reflectance daily
//   MYD09GA — MODIS Aqua surface reflectance daily
//   VNP09GA — VIIRS surface reflectance daily
// These are small concept-id prefixes; CMR will resolve via short_name too.
const COLLECTIONS = ['MOD09GA', 'MYD09GA', 'VNP09GA']

interface Granule {
  id: string
  title: string
  collection: string
  timeStart: string
  timeEnd?: string
  dayNightFlag?: string
  cloudCoverPct?: number
  boundingBox?: string
  downloadUrl?: string
}

async function fetchGranules(bbox: BoundingBox | null, since: Date): Promise<Granule[]> {
  if (!bbox) return []

  const start = new Date(since.getTime() - 30 * 24 * 60 * 60 * 1000)
  const out: Granule[] = []

  for (const collection of COLLECTIONS) {
    try {
      const params = new URLSearchParams({
        short_name: collection,
        bounding_box: `${bbox.swLng},${bbox.swLat},${bbox.neLng},${bbox.neLat}`,
        temporal: `${start.toISOString()},${since.toISOString()}`,
        page_size: '20',
        sort_key: '-start_date',
      })
      const res = await fetchWithTimeout(`${CMR_URL}?${params}`, TIMEOUT_MS, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        console.warn(`[raw-signals/nasa-earthdata] ${collection} HTTP ${res.status}`)
        continue
      }
      const data = (await res.json()) as {
        feed?: { entry?: Array<Record<string, unknown>> }
      }
      for (const e of (data.feed?.entry ?? []).slice(0, 10)) {
        out.push({
          id: String(e.id ?? ''),
          title: String(e.title ?? ''),
          collection,
          timeStart: String(e.time_start ?? ''),
          timeEnd: e.time_end ? String(e.time_end) : undefined,
          dayNightFlag: e.day_night_flag ? String(e.day_night_flag) : undefined,
          cloudCoverPct: typeof e.cloud_cover === 'number' ? (e.cloud_cover as number) : undefined,
          boundingBox: Array.isArray(e.boxes) && e.boxes.length > 0 ? String((e.boxes as string[])[0]) : undefined,
          downloadUrl: Array.isArray(e.links) && e.links.length > 0
            ? String(((e.links as Array<{ href?: string }>)[0]?.href ?? ''))
            : undefined,
        })
      }
    } catch (err) {
      console.warn(`[raw-signals/nasa-earthdata] ${collection} fetch failed:`, err instanceof Error ? err.message : err)
    }
  }

  return out.slice(0, 30)
}

const HAIKU_SYSTEM = `You assess NASA Earthdata (MODIS + VIIRS) granule availability against a news story.
Given granules covering the story's region in the 30-day pre-story window, return:
- granulesRelevant: count of granules within a few days of the claimed event (<= 5 day revisit)
- clearImageryAvailable: true if any granule has cloudCoverPct under 30 and day-flag='DAY'
- narrativeGap: true if overhead imagery was available during the event window that could independently verify or contradict narrative claims, and the story does not reference overhead verification
- description: 1-2 sentences or empty
Return JSON only:
{ "granulesRelevant": 0, "clearImageryAvailable": false, "narrativeGap": false, "description": "" }`

export const nasaEarthdataRunner: IntegrationRunner = async (ctx) => {
  const { cluster, signalType } = ctx
  const geo = await extractGeoForSignal(signalType, cluster.entities, cluster.headline, cluster.synopsis)
  const granules = await fetchGranules(geo.boundingBox, cluster.firstDetectedAt)

  if (granules.length === 0) {
    return {
      rawContent: { bbox: geo.boundingBox, granules: [] },
      haikuSummary: 'No NASA Earthdata granules retrieved.',
      signalSource: 'nasa-earthdata-cmr', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { granulesRelevant: 0, clearImageryAvailable: false, narrativeGap: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nRegion: ${geo.regionLabel ?? 'unknown'}\n\nGranules (30d, MODIS+VIIRS):\n${granules.slice(0, 15).map((g, i) => `${i + 1}. ${g.collection} | ${g.timeStart} | cloud=${g.cloudCoverPct ?? '?'}% | ${g.dayNightFlag ?? '?'}`).join('\n')}`,
      agentType: 'raw_signal_nasa_earthdata', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/nasa-earthdata] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { granules: granules.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.granulesRelevant} relevant granules${assessment.clearImageryAvailable ? ' (clear imagery available)' : ''}`,
    signalSource: 'nasa-earthdata-cmr', captureDate: cluster.firstDetectedAt, coordinates: geo.boundingBox,
    divergenceFlag: assessment.narrativeGap,
    divergenceDescription: assessment.narrativeGap ? assessment.description : null,
    confidenceLevel: assessment.clearImageryAvailable ? 'medium' : 'low',
  }
}
