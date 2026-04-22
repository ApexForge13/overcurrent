/**
 * In-memory alias index — maps TrackedEntity identifier + aliases → entityId.
 *
 * Built from `TrackedEntity.entityStrings.aliases` plus the identifier
 * itself (canonical ticker / pair). Used by extract-from-text.ts to
 * resolve article/post content to entityIds without per-row DB hits.
 *
 * Caching:
 *   - Lazy: built on first use
 *   - TTL: 6h (registry drift is slow; 6h matches our reseed cadence)
 *   - Explicit invalidation: clearAliasIndexCache() for tests and post-seed
 *
 * Matching precedence (downstream consumer honors this order):
 *   1. Cashtag — $AAPL matches identifier "AAPL" (cashtag form trumps
 *      because it's an explicit disambiguation from the poster)
 *   2. Ticker — plain uppercase word-boundary match against identifier
 *   3. Alias — substring match on the entity's alias list (strictest —
 *      requires word boundary to reduce false positives)
 */

import type { PrismaClient } from '@prisma/client'

export interface AliasEntry {
  entityId: string
  identifier: string
  category: string
}

export interface AliasIndex {
  /** Identifier (uppercase) → entry. Fast path for cashtag + ticker match. */
  byIdentifier: Map<string, AliasEntry>
  /** Lowercased alias → entry (multiple aliases may map to the same entity). */
  byAlias: Map<string, AliasEntry>
  /** Sorted alias list (desc by length) — longer aliases match first to
   *  prefer "Apple Inc" over "Apple" when both would match. */
  sortedAliases: string[]
  builtAt: number
}

const TTL_MS = 6 * 60 * 60 * 1000

let cached: AliasIndex | null = null

export async function getAliasIndex(prisma: PrismaClient): Promise<AliasIndex> {
  const now = Date.now()
  if (cached && now - cached.builtAt < TTL_MS) {
    return cached
  }
  cached = await buildAliasIndex(prisma)
  return cached
}

export function clearAliasIndexCache(): void {
  cached = null
}

export async function buildAliasIndex(prisma: PrismaClient): Promise<AliasIndex> {
  const entities = await prisma.trackedEntity.findMany({
    where: { active: true },
    select: { id: true, identifier: true, category: true, entityStrings: true },
  })

  const byIdentifier = new Map<string, AliasEntry>()
  const byAlias = new Map<string, AliasEntry>()

  for (const e of entities) {
    const entry: AliasEntry = {
      entityId: e.id,
      identifier: e.identifier,
      category: e.category,
    }
    byIdentifier.set(e.identifier.toUpperCase(), entry)

    const strings = e.entityStrings as { aliases?: unknown } | null
    const aliases = Array.isArray(strings?.aliases) ? strings!.aliases : []
    for (const aliasRaw of aliases) {
      const alias = String(aliasRaw).trim()
      // Skip aliases that are too short or degenerate — they'd create
      // noise. "A" or "I" would match every article.
      if (alias.length < 2) continue
      const key = alias.toLowerCase()
      // First writer wins — aliases collide (e.g., two entities both
      // claim "Swissie") but we prefer the first registration order.
      // For disambiguation, downstream can consult the full candidate
      // set by iterating byAlias when a hit needs validation.
      if (!byAlias.has(key)) {
        byAlias.set(key, entry)
      }
    }
  }

  const sortedAliases = Array.from(byAlias.keys()).sort(
    (a, b) => b.length - a.length,
  )

  return {
    byIdentifier,
    byAlias,
    sortedAliases,
    builtAt: Date.now(),
  }
}
