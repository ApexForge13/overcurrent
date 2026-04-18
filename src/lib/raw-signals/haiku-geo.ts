/**
 * Haiku geo-extraction — shared helper for raw-signal integrations.
 *
 * Given a StoryCluster's entities + headline + synopsis, ask Haiku to produce
 * a bounding box that's most relevant for the specific signal type being
 * queried. E.g., for maritime_ais on an Iran story, return the Persian Gulf;
 * for satellite_optical, return the specific conflict zone.
 *
 * Returns null on any failure — integrations should degrade gracefully
 * (skip the query, log RawSignalQueue with confidenceLevel low).
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import type { BoundingBox } from './types'

export interface GeoExtractionResult {
  boundingBox: BoundingBox | null
  /** Human-readable description of the region ("Persian Gulf", "Eastern Ukraine") */
  regionLabel: string | null
  confidenceLevel: 'low' | 'medium' | 'high'
  costUsd: number
}

const SYSTEM_PROMPT = `You extract geographic bounding boxes from news stories for cross-referencing with external data sources (satellite imagery, aircraft tracking, vessel AIS, etc.).

Your job: given a story's entities + summary + the TYPE of external data being queried, return the single most relevant bounding box.

Rules:
- Return real-world lat/lng coordinates (WGS84)
- Bounding box format: { swLat, swLng, neLat, neLng } where sw = southwest corner, ne = northeast corner
- Keep boxes tight: narrowest box that covers the story's geographic focus for THIS signal type
- For maritime queries, prefer sea/strait bounding boxes over land
- For satellite queries, prefer the specific conflict zone / event location over whole-country boxes
- If the story has no clear geographic focus, return null for boundingBox
- Return a short human-readable regionLabel ("Persian Gulf", "Gaza Strip", "Kinmen Islands")
- confidenceLevel: "high" if coordinates are unambiguous, "medium" if approximate, "low" if guessing

Return JSON only, no explanation:
{
  "boundingBox": { "swLat": 24.5, "swLng": 48.0, "neLat": 30.5, "neLng": 57.0 } | null,
  "regionLabel": "Persian Gulf" | null,
  "confidenceLevel": "high" | "medium" | "low"
}`

export async function extractGeoForSignal(
  signalType: string,
  entities: string[],
  headline: string,
  synopsis: string,
): Promise<GeoExtractionResult> {
  try {
    const userPrompt = `Signal type being queried: ${signalType}

Story entities: ${entities.slice(0, 20).join(', ')}

Headline: ${headline}

Summary: ${synopsis.substring(0, 1500)}

Return the single most relevant bounding box for querying ${signalType} data related to this story. Return JSON only.`

    const result = await callClaude({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'raw_signal_geo',
      maxTokens: 512,
    })

    const parsed = parseJSON<{
      boundingBox: BoundingBox | null
      regionLabel: string | null
      confidenceLevel: 'low' | 'medium' | 'high'
    }>(result.text)

    // Sanity check: coordinates must be in valid WGS84 range
    if (parsed.boundingBox) {
      const { swLat, swLng, neLat, neLng } = parsed.boundingBox
      const valid =
        typeof swLat === 'number' && typeof swLng === 'number' &&
        typeof neLat === 'number' && typeof neLng === 'number' &&
        swLat >= -90 && swLat <= 90 &&
        neLat >= -90 && neLat <= 90 &&
        swLng >= -180 && swLng <= 180 &&
        neLng >= -180 && neLng <= 180 &&
        swLat <= neLat // allow swLng > neLng for international-date-line crossings
      if (!valid) {
        console.warn(`[raw-signals/geo] Invalid bounding box from Haiku, returning null:`, parsed.boundingBox)
        return {
          boundingBox: null,
          regionLabel: parsed.regionLabel,
          confidenceLevel: 'low',
          costUsd: result.costUsd,
        }
      }
    }

    return {
      boundingBox: parsed.boundingBox,
      regionLabel: parsed.regionLabel,
      confidenceLevel: parsed.confidenceLevel ?? 'low',
      costUsd: result.costUsd,
    }
  } catch (err) {
    console.warn(
      `[raw-signals/geo] Extraction failed for ${signalType}:`,
      err instanceof Error ? err.message : err,
    )
    return {
      boundingBox: null,
      regionLabel: null,
      confidenceLevel: 'low',
      costUsd: 0,
    }
  }
}
