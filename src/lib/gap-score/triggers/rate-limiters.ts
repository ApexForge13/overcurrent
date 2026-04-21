/**
 * Shared rate limiters for external API calls from triggers.
 *
 * Wraps the existing token-bucket rate limiter at src/lib/rate-limit.ts.
 * Per-API buckets so triggers hitting different APIs don't starve each
 * other. Phase 1c.2 + beyond: add limiter presets for each new integration.
 */

import { checkRateLimit } from '@/lib/rate-limit'

/** SEC EDGAR — 10 req/sec per their stated policy. Conservative: 8 req/sec. */
export async function checkSecRateLimit(): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const result = checkRateLimit('trigger:sec', 8, 1000)
  return { allowed: result.allowed, retryAfterMs: result.allowed ? 0 : 1000 }
}

/** FRED — 120 req/min per their docs. Conservative: 100/min. */
export async function checkFredRateLimit(): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const result = checkRateLimit('trigger:fred', 100, 60_000)
  return { allowed: result.allowed, retryAfterMs: result.allowed ? 0 : 60_000 }
}

/**
 * Sleep until the next tick if rate-limited. Short-circuit helper used in
 * scanner loops — call this before each external fetch to respect the
 * limiter without manually checking.
 */
export async function acquireSec(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { allowed, retryAfterMs } = await checkSecRateLimit()
    if (allowed) return
    await new Promise((r) => setTimeout(r, retryAfterMs))
  }
}

export async function acquireFred(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { allowed, retryAfterMs } = await checkFredRateLimit()
    if (allowed) return
    await new Promise((r) => setTimeout(r, retryAfterMs))
  }
}
