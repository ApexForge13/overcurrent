/**
 * Entity extraction at analysis publish time.
 *
 * Takes the cluster's flat keyword list + story headline + synopsis and
 * canonicalizes every named entity into the Entity table, then writes
 * EntityMention rows linking each entity to the story.
 *
 * The cluster already tracks entity-adjacent strings in StoryCluster.clusterKeywords
 * (a JSON-string array populated by signal tracking). This module TYPES those
 * strings — person vs organization vs location vs vessel vs country vs company —
 * and creates durable Entity records that power the entity dossier, knowledge
 * graph, and alert monitors.
 *
 * Idempotent: upserts by slug, skips existing EntityMention duplicates.
 * Non-blocking: errors are logged and swallowed.
 *
 * Cost: ~$0.002 per call (Haiku, small prompt). One call per analysis.
 */

import { prisma } from '@/lib/db'
import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'

const ENTITY_TYPES = ['person', 'organization', 'location', 'vessel', 'country', 'company'] as const
type EntityType = typeof ENTITY_TYPES[number]

interface ExtractedEntity {
  name: string
  type: EntityType
  description?: string | null
  /** Short mention context for the EntityMention row (why this entity matters in this story) */
  mentionContext: string
}

const SYSTEM_PROMPT = `You are a named-entity typing specialist. Given a news analysis and a flat list of entity candidate strings pulled from its cluster, produce a clean canonical list of entities with types.

Rules:
- Each entity gets exactly one type: person | organization | location | vessel | country | company
  - person:       individual human (named politicians, executives, suspects, etc.)
  - organization: non-commercial groups (government agencies, NGOs, militant groups, think tanks)
  - location:     sub-national place (cities, regions, airports, chokepoints, named landmarks)
  - vessel:       named ship, aircraft, satellite
  - country:      sovereign state
  - company:      commercial enterprise (publicly traded or private)
- Merge duplicates and near-duplicates into one entity (prefer the most complete/formal name)
- Drop entries that are not actually named entities (common nouns, adjectives, verbs, dates, numbers)
- Drop ambiguous or low-signal entries rather than guessing
- description: one short sentence describing the entity in the context of this story (max 120 chars)
- mentionContext: one sentence describing why this entity matters to THIS specific analysis (max 160 chars)

Return JSON only, no explanation:
{
  "entities": [
    { "name": "Ayatollah Ali Khamenei", "type": "person", "description": "Supreme Leader of Iran since 1989", "mentionContext": "Referenced as authorizing the military response" },
    ...
  ]
}`

/**
 * Haiku call only — does not write to DB. Caller is responsible for persistence.
 */
export async function extractEntitiesFromStory(
  headline: string,
  synopsis: string,
  clusterKeywords: string[],
  storyId?: string,
): Promise<ExtractedEntity[]> {
  try {
    const userPrompt = `Headline: ${headline}

Synopsis: ${synopsis.substring(0, 2000)}

Cluster keyword candidates (raw, may contain noise):
${clusterKeywords.slice(0, 50).map((k, i) => `${i + 1}. ${k}`).join('\n')}

Return JSON only with the typed entity list.`

    const result = await callClaude({
      model: HAIKU,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      agentType: 'publish_entity_extraction',
      maxTokens: 2048,
      storyId,
    })

    const parsed = parseJSON<{ entities?: ExtractedEntity[] }>(result.text)
    if (!parsed.entities || !Array.isArray(parsed.entities)) return []

    return parsed.entities
      .filter((e) => e && typeof e.name === 'string' && ENTITY_TYPES.includes(e.type))
      .map((e) => ({
        name: e.name.trim(),
        type: e.type,
        description: e.description?.trim() || null,
        mentionContext: e.mentionContext?.trim() || '',
      }))
      .filter((e) => e.name.length > 0 && e.name.length <= 200)
  } catch (err) {
    console.warn(
      '[publish-hooks/entities] extractEntitiesFromStory failed:',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

/**
 * Produce a deterministic slug from a name. Used as the unique Entity key so
 * upserts are safe across sessions even when the extractor produces slight
 * variations (capitalization, trailing whitespace).
 */
export function slugifyEntityName(name: string, type: EntityType): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 120)
  // Prefix with type to prevent collisions across types (Apple the company vs Apple the place)
  return `${type}--${base}`
}

/**
 * Upsert Entity rows and write EntityMention records for this story.
 * Idempotent — safe to call more than once per story.
 *
 * Returns the Entity ids written (for downstream graph/signal-index hooks).
 */
export async function populateStoryEntities(storyId: string): Promise<string[]> {
  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: {
        id: true,
        headline: true,
        synopsis: true,
        storyClusterId: true,
      },
    })
    if (!story) return []

    // Source the candidate keyword list: prefer cluster keywords (already
    // populated by signal tracking), fall back to a simple split on headline+synopsis
    // which will almost always be filtered down hard by the Haiku step.
    let clusterKeywords: string[] = []
    if (story.storyClusterId) {
      const cluster = await prisma.storyCluster.findUnique({
        where: { id: story.storyClusterId },
        select: { clusterKeywords: true },
      })
      if (cluster) {
        try {
          const parsed = JSON.parse(cluster.clusterKeywords)
          if (Array.isArray(parsed)) clusterKeywords = parsed.map((k) => String(k))
        } catch {
          // ignore malformed keywords
        }
      }
    }

    if (clusterKeywords.length === 0) {
      // No cluster keywords yet — skip. Entity extraction will re-run on
      // the next re-analysis when the cluster is populated.
      return []
    }

    const extracted = await extractEntitiesFromStory(
      story.headline,
      story.synopsis,
      clusterKeywords,
      story.id,
    )

    if (extracted.length === 0) return []

    const writtenIds: string[] = []

    for (const entity of extracted) {
      const slug = slugifyEntityName(entity.name, entity.type)
      try {
        // Upsert Entity — safe across concurrent calls (slug is @unique)
        const dbEntity = await prisma.entity.upsert({
          where: { slug },
          create: {
            name: entity.name,
            type: entity.type,
            slug,
            description: entity.description,
            isPublic: true,
          },
          update: {
            // If description was previously null and we now have one, fill it in.
            // Don't overwrite a populated description with null.
            ...(entity.description ? { description: entity.description } : {}),
          },
        })

        // Write EntityMention. Deduplicate on (entityId, storyId) — no
        // formal unique constraint, so we check first.
        const existingMention = await prisma.entityMention.findFirst({
          where: { entityId: dbEntity.id, storyId: story.id },
          select: { id: true },
        })
        if (!existingMention) {
          await prisma.entityMention.create({
            data: {
              entityId: dbEntity.id,
              storyId: story.id,
              mentionContext: entity.mentionContext || `Mentioned in "${story.headline.substring(0, 80)}"`,
            },
          })
        }

        writtenIds.push(dbEntity.id)
      } catch (err) {
        console.warn(
          `[publish-hooks/entities] Failed to persist ${entity.type} "${entity.name}":`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    return writtenIds
  } catch (err) {
    console.warn(
      '[publish-hooks/entities] populateStoryEntities failed:',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}
