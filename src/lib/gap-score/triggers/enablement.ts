/**
 * TriggerEnablement resolution — DB-backed admin control with fallback.
 *
 * Replaces the env-var-only `isTriggerEnabled()` from earlier phases with
 * a three-level resolution chain (per manifest A3):
 *
 *   1. DB row in TriggerEnablement — if present, its `enabled` wins
 *   2. env var TRIGGER_<ID>_ENABLED — if set to '1' / 'true' (or '0' /
 *      'false'), that wins
 *   3. Default: **ENABLED** — per user decision. If a trigger is
 *      registered in code, intent is to fire. Admin UI is for disabling
 *      noisy triggers, not enabling silent ones.
 *
 * Threshold overrides: `getThresholdOverrides(triggerId)` returns the
 * TriggerEnablement.thresholdOverrides JSON or null. Used by dispatcher
 * to populate TriggerContext.thresholds per scan.
 *
 * Cache: 60s TTL in-memory to avoid per-scan DB query. Admin-UI writes
 * bust the cache via `clearEnablementCache()` — API routes call this
 * after upsert.
 */

import type { PrismaClient } from '@prisma/client'

const TTL_MS = 60 * 1000

interface CacheEntry {
  enabled: boolean
  thresholdOverrides: Record<string, number> | null
  loadedAt: number
}

let cache: Map<string, CacheEntry> | null = null
let cacheLoadedAt = 0

async function loadCache(prisma: PrismaClient): Promise<Map<string, CacheEntry>> {
  const rows = await prisma.triggerEnablement.findMany({
    select: { triggerId: true, enabled: true, thresholdOverrides: true },
  })
  const map = new Map<string, CacheEntry>()
  for (const row of rows) {
    const overrides = coerceThresholds(row.thresholdOverrides)
    map.set(row.triggerId, {
      enabled: row.enabled,
      thresholdOverrides: overrides,
      loadedAt: Date.now(),
    })
  }
  cache = map
  cacheLoadedAt = Date.now()
  return map
}

function coerceThresholds(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, number> = {}
  let any = false
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v
      any = true
    }
  }
  return any ? out : null
}

export function clearEnablementCache(): void {
  cache = null
  cacheLoadedAt = 0
}

/**
 * Resolve whether a trigger is enabled. DB → env → default-ENABLED.
 */
export async function isTriggerEnabledWithFallback(
  prisma: PrismaClient,
  triggerId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const now = Date.now()
  if (!cache || now - cacheLoadedAt > TTL_MS) {
    await loadCache(prisma)
  }
  const entry = cache!.get(triggerId)
  if (entry) return entry.enabled

  // Fall back to env var
  const envVarName = `TRIGGER_${triggerId.replace(/-/g, '_')}_ENABLED`
  const envValue = env[envVarName]
  if (envValue !== undefined) {
    const norm = envValue.trim().toLowerCase()
    if (norm === '1' || norm === 'true') return true
    if (norm === '0' || norm === 'false') return false
  }

  // Default ENABLED (manifest A3 — user choice: intent-to-fire)
  return true
}

/**
 * Get threshold overrides for a trigger. Null if no DB row or no overrides.
 */
export async function getThresholdOverrides(
  prisma: PrismaClient,
  triggerId: string,
): Promise<Record<string, number> | null> {
  const now = Date.now()
  if (!cache || now - cacheLoadedAt > TTL_MS) {
    await loadCache(prisma)
  }
  const entry = cache!.get(triggerId)
  return entry?.thresholdOverrides ?? null
}

/**
 * Test-only helper to inspect cache state.
 */
export function _getCacheSize(): number {
  return cache?.size ?? 0
}
