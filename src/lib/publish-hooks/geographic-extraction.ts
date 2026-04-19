/**
 * Geographic extraction at analysis publish time.
 *
 * Haiku call that reads the story's headline + synopsis and returns:
 *   - coordinatesJson: { swLat, swLng, neLat, neLng } — primary bounding box
 *   - primaryCountry:  ISO 3166-1 alpha-2 code of the main geographic locus
 *
 * Different from raw-signals/haiku-geo.ts — that module produces *per-signal-type*
 * bounding boxes (e.g. Persian Gulf for maritime_ais even when the story is
 * framed around Iran). This module produces the ONE canonical story-level
 * location used for the public map view and primaryCountry filters.
 *
 * Cost: ~$0.001 per call (Haiku, small prompt). Runs once per analysis at
 * publish time. Non-blocking — failure leaves Story.coordinatesJson null,
 * map view simply omits the marker.
 */

import { prisma } from '@/lib/db'
import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'

export interface StoryCoordinates {
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

interface HaikuGeoResult {
  coordinates: StoryCoordinates | null
  primaryCountry: string | null
}

const SYSTEM_PROMPT = `You are a geographic extraction specialist. Given a news analysis headline and synopsis, return the SINGLE most relevant geographic bounding box and primary country for the story.

Rules:
- coordinates: WGS84 lat/lng as { swLat, swLng, neLat, neLng } where sw = southwest corner, ne = northeast corner
- Keep boxes tight: narrowest box that covers the story's primary geographic focus
- Stories with multiple locations: use the one most central to the headline
- Stories with no clear geographic focus (e.g. purely financial/policy): return null for both
- primaryCountry: ISO 3166-1 alpha-2 code (e.g. "US", "IR", "CN", "UA"). Use "XX" for supranational events only if no single country dominates
- confidenceLevel is implied — if unsure, return null rather than guessing

Return JSON only, no explanation:
{
  "coordinates": { "swLat": 30.0, "swLng": 44.0, "neLat": 40.0, "neLng": 63.0 } | null,
  "primaryCountry": "IR" | null
}`

/**
 * Extract story-level coordinates via Haiku. Always returns a result object;
 * null fields when the story has no clear geographic focus or the call fails.
 *
 * Non-throwing — caller does not need try/catch.
 */
export async function extractStoryGeography(
  headline: string,
  synopsis: string,
  storyId?: string,
): Promise<HaikuGeoResult> {
  try {
    const userPrompt = `Headline: ${headline}

Synopsis: ${synopsis.substring(0, 2000)}

Return JSON only.`

    const result = await callClaude({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'publish_geographic_extraction',
      maxTokens: 256,
      storyId,
    })

    const parsed = parseJSON<HaikuGeoResult>(result.text)

    if (parsed.coordinates) {
      const { swLat, swLng, neLat, neLng } = parsed.coordinates
      const valid =
        typeof swLat === 'number' && typeof swLng === 'number' &&
        typeof neLat === 'number' && typeof neLng === 'number' &&
        swLat >= -90 && swLat <= 90 &&
        neLat >= -90 && neLat <= 90 &&
        swLng >= -180 && swLng <= 180 &&
        neLng >= -180 && neLng <= 180 &&
        swLat <= neLat
      if (!valid) {
        return { coordinates: null, primaryCountry: parsed.primaryCountry ?? null }
      }
    }

    return {
      coordinates: parsed.coordinates ?? null,
      primaryCountry: parsed.primaryCountry ?? null,
    }
  } catch (err) {
    console.warn(
      '[publish-hooks/geo] extractStoryGeography failed:',
      err instanceof Error ? err.message : err,
    )
    return { coordinates: null, primaryCountry: null }
  }
}

/**
 * Orchestrator: extracts + writes to Story.coordinatesJson and Story.primaryCountry.
 * Fire-and-forget safe — errors swallowed and logged.
 */
export async function populateStoryGeography(storyId: string): Promise<void> {
  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, headline: true, synopsis: true, coordinatesJson: true, primaryCountry: true },
    })
    if (!story) return

    // Idempotent — skip if already populated
    if (story.coordinatesJson && story.primaryCountry) return

    const geo = await extractStoryGeography(story.headline, story.synopsis, story.id)

    await prisma.story.update({
      where: { id: storyId },
      data: {
        coordinatesJson: (geo.coordinates as object | null) ?? undefined,
        primaryCountry: geo.primaryCountry ?? undefined,
      },
    })
  } catch (err) {
    console.warn(
      '[publish-hooks/geo] populateStoryGeography failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
