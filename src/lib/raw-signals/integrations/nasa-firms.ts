/**
 * NASA FIRMS integration — active fire & thermal anomaly detections.
 *
 * ── Environment Variables ─────────────────────────────────────────────
 *   NASA_FIRMS_MAP_KEY (optional — recommended for higher rate limits)
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Free. With a MAP_KEY (free registration), higher rate limits apply.
 *
 * ── What It Does ──────────────────────────────────────────────────────
 * Queries NASA FIRMS (Fire Information for Resource Management System)
 * for active fire detections from VIIRS (375m resolution) and MODIS
 * (1km resolution) sensors in the story's bounding box and 10-day window.
 *
 * Use cases:
 *  - Environmental event coverage (wildfires, industrial fires)
 *  - Conflict zones (military fires, shelling artifacts, oil well fires)
 *  - Civil unrest (riot burns, protest site fires)
 *  - Omission check: coverage says "no fires" while FIRMS shows hotspots?
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import { extractGeoForSignal } from '../haiku-geo'
import type { IntegrationRunner } from '../runner'

const FIRMS_TIMEOUT_MS = 20_000
// API docs: https://firms.modaps.eosdis.nasa.gov/api/area/
const FIRMS_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'

interface FireDetection {
  latitude: number
  longitude: number
  brightness: number
  acqDate: string
  acqTime: string
  confidence: string
  frp?: number // Fire Radiative Power
  daynight: string
  source: 'VIIRS' | 'MODIS'
}

function parseCsvRow(row: string, headers: string[]): Record<string, string> {
  const values = row.split(',')
  const obj: Record<string, string> = {}
  headers.forEach((h, i) => {
    obj[h.trim()] = (values[i] ?? '').trim()
  })
  return obj
}

async function queryFirms(
  source: 'VIIRS_SNPP_NRT' | 'MODIS_NRT',
  bbox: { swLat: number; swLng: number; neLat: number; neLng: number },
  days: number,
): Promise<FireDetection[]> {
  const mapKey = process.env.NASA_FIRMS_MAP_KEY
  if (!mapKey) {
    // FIRMS requires a MAP_KEY for the API endpoint. Without it, we cannot query.
    console.warn('[raw-signals/nasa-firms] NASA_FIRMS_MAP_KEY not set — skipping')
    return []
  }

  const area = `${bbox.swLng},${bbox.swLat},${bbox.neLng},${bbox.neLat}`
  const daysCapped = Math.min(Math.max(days, 1), 10)
  const url = `${FIRMS_API_BASE}/${mapKey}/${source}/${area}/${daysCapped}`

  try {
    const res = await fetchWithTimeout(url, FIRMS_TIMEOUT_MS, {
      headers: { Accept: 'text/csv' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/nasa-firms] HTTP ${res.status} for ${source}`)
      return []
    }
    const csv = await res.text()
    const lines = csv.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map((h) => h.trim())
    const sensorLabel: FireDetection['source'] = source.startsWith('VIIRS')
      ? 'VIIRS'
      : 'MODIS'
    return lines.slice(1, 500).map((row) => {
      const r = parseCsvRow(row, headers)
      return {
        latitude: parseFloat(r.latitude ?? '0'),
        longitude: parseFloat(r.longitude ?? '0'),
        brightness: parseFloat(r.brightness ?? r.bright_ti4 ?? '0'),
        acqDate: r.acq_date ?? '',
        acqTime: r.acq_time ?? '',
        confidence: r.confidence ?? '',
        frp: r.frp ? parseFloat(r.frp) : undefined,
        daynight: r.daynight ?? '',
        source: sensorLabel,
      }
    })
  } catch (err) {
    console.warn(
      `[raw-signals/nasa-firms] ${source} query failed:`,
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

const HAIKU_SYSTEM_PROMPT = `You assess NASA FIRMS active fire satellite detections against a news story.

Given a story and a list of fire hotspots detected by VIIRS (375m) and MODIS (1km) sensors in the same region/timeframe, answer:
1. How many distinct fire clusters were detected?
2. Does the fire activity corroborate the narrative (e.g., story mentions wildfire, FIRMS confirms)?
3. Does FIRMS detect fires the story doesn't mention (omission)?
4. Is the intensity (brightness, FRP) notable?

Reliability notes:
- VIIRS has higher resolution and detects smaller fires
- "nominal" confidence is default; "high" is stronger signal
- Below 3 detections, treat as noise — do NOT flag divergence

Return JSON only:
{
  "detectionCount": number,
  "summary": "string (1 sentence)",
  "corroboratesNarrative": boolean,
  "addsMissingContext": boolean,
  "contextDescription": "string (1-2 sentences)"
}`

export const nasaFirmsRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster, signalType } = ctx

  const geo = await extractGeoForSignal(
    signalType,
    cluster.entities,
    cluster.headline,
    cluster.synopsis,
  )

  if (!geo.boundingBox) {
    return {
      rawContent: { note: 'No bounding box extracted' },
      haikuSummary: 'No geographic region available for FIRMS query.',
      signalSource: 'nasa-firms',
      captureDate: new Date(),
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  // FIRMS supports up to 10 days — query the window up to firstDetectedAt
  const [viirs, modis] = await Promise.all([
    queryFirms('VIIRS_SNPP_NRT', geo.boundingBox, 10),
    queryFirms('MODIS_NRT', geo.boundingBox, 10),
  ])

  const allDetections = [...viirs, ...modis]

  if (allDetections.length === 0) {
    return {
      rawContent: {
        query: {
          bbox: geo.boundingBox,
          regionLabel: geo.regionLabel,
          windowDays: 10,
        },
        detections: [],
        viirsCount: 0,
        modisCount: 0,
        note: 'No active fire detections',
      },
      haikuSummary: 'No active fire detections in region (10-day window).',
      signalSource: 'nasa-firms',
      captureDate: cluster.firstDetectedAt,
      coordinates: geo.boundingBox,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  }

  // Sort by acquisition date descending, cap for Haiku
  const sampleDetections = allDetections
    .sort((a, b) => b.acqDate.localeCompare(a.acqDate))
    .slice(0, 20)

  const userPrompt = `Story headline: ${cluster.headline}

Story summary: ${cluster.synopsis.substring(0, 1200)}

Region: ${geo.regionLabel ?? 'unknown'}
Window: 10 days preceding story break (${cluster.firstDetectedAt.toISOString().split('T')[0]})

Fire detections: VIIRS=${viirs.length}, MODIS=${modis.length}, total=${allDetections.length}

Top 20 by date:
${sampleDetections
  .map(
    (d, i) =>
      `${i + 1}. ${d.acqDate} ${d.acqTime}UTC | (${d.latitude.toFixed(3)},${d.longitude.toFixed(3)}) | ${d.source} | conf=${d.confidence} | brightness=${d.brightness.toFixed(0)}K${d.frp ? ` | FRP=${d.frp.toFixed(0)}MW` : ''}`,
  )
  .join('\n')}

Assess whether these fires corroborate the story or reveal coverage gaps. Below 3 detections, do NOT flag divergence.`

  let assessment
  let haikuCost = 0
  try {
    const result = await callClaude({
      model: HAIKU,
      systemPrompt: HAIKU_SYSTEM_PROMPT,
      userPrompt,
      agentType: 'raw_signal_nasa_firms',
      maxTokens: 600,
    })
    haikuCost = result.costUsd
    assessment = parseJSON<{
      detectionCount: number
      summary: string
      corroboratesNarrative: boolean
      addsMissingContext: boolean
      contextDescription: string
    }>(result.text)
  } catch (err) {
    console.warn(
      '[raw-signals/nasa-firms] Haiku assessment failed:',
      err instanceof Error ? err.message : err,
    )
    assessment = {
      detectionCount: allDetections.length,
      summary: `${allDetections.length} fire detections captured; Haiku failed`,
      corroboratesNarrative: false,
      addsMissingContext: false,
      contextDescription: '',
    }
  }

  const belowThreshold = allDetections.length < 3
  const divergenceFlag = !belowThreshold && assessment.addsMissingContext
  const divergenceDescription = divergenceFlag ? assessment.contextDescription : null

  return {
    rawContent: {
      query: {
        bbox: geo.boundingBox,
        regionLabel: geo.regionLabel,
        windowDays: 10,
        haikuCostUsd: haikuCost,
      },
      detections: sampleDetections,
      viirsCount: viirs.length,
      modisCount: modis.length,
      assessment,
    },
    haikuSummary:
      assessment.summary ||
      `${allDetections.length} fire detections (VIIRS=${viirs.length}, MODIS=${modis.length})`,
    signalSource: 'nasa-firms',
    captureDate: cluster.firstDetectedAt,
    coordinates: geo.boundingBox,
    divergenceFlag,
    divergenceDescription,
    confidenceLevel: belowThreshold
      ? 'low'
      : allDetections.length >= 20
        ? 'high'
        : 'medium',
  }
}
