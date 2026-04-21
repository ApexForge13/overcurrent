/**
 * Shared Redis connection + queue-prefix getter for BullMQ.
 *
 * One connection is shared across all Queue and Worker instances to avoid
 * opening a new Redis connection per queue. The connection is created lazily
 * on first call to getRedisConnection() so that importing this module during
 * build / test / cold start doesn't eagerly dial Upstash.
 *
 * Two non-negotiables for BullMQ compatibility:
 *   1. maxRetriesPerRequest: null
 *        BullMQ workers block on BRPOPLPUSH for job pickup. If ioredis retries
 *        the blocking call on a transient error, it corrupts the worker state.
 *        BullMQ docs explicitly require this setting for the connection passed
 *        to Worker. We apply it here so Queue + Worker share the same safe
 *        connection.
 *   2. enableReadyCheck: false
 *        Upstash TLS instances reject the INFO command ioredis runs as a
 *        readiness probe. Disabling it avoids a spurious boot-time error on
 *        Upstash without affecting actual command behavior.
 *
 * The queue prefix isolates environments on a shared Upstash instance:
 *   - Production deploys set QUEUE_PREFIX=overcurrent:prod:
 *   - Preview  deploys set QUEUE_PREFIX=overcurrent:preview:
 *   - Dev / local   set QUEUE_PREFIX=overcurrent:dev:  (also the fallback)
 * Prefix MUST be applied to BOTH Queue and Worker options — BullMQ does not
 * infer it. See queue-factories.test.ts for the regression test covering both.
 */

import { Redis } from 'ioredis'

let connection: Redis | null = null

export function getRedisConnection(url: string | undefined = process.env.REDIS_URL): Redis {
  if (connection) return connection
  if (!url) {
    throw new Error(
      'REDIS_URL is not set. Set it in .env (local) or the host environment (Vercel/Railway).',
    )
  }
  connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  })
  return connection
}

/**
 * Environment-scoped prefix applied to every Queue and Worker.
 * Defaults to 'overcurrent:dev:' when QUEUE_PREFIX is unset so local
 * development on a shared Upstash instance can't collide with a deployed
 * environment that forgot to set the var.
 */
export function getQueuePrefix(): string {
  return process.env.QUEUE_PREFIX ?? 'overcurrent:dev:'
}

/**
 * Close the shared connection. Idempotent — safe to call multiple times
 * (e.g. in test teardown and shutdown handlers simultaneously).
 */
export async function closeRedisConnection(): Promise<void> {
  if (!connection) return
  const toClose = connection
  connection = null
  try {
    await toClose.quit()
  } catch {
    // ioredis.quit() can throw if the connection is already closing; swallow.
  }
}

/**
 * Test-only: reset the cached connection without closing it (for cases where
 * the connection was never opened). Do not call from production code.
 */
export function __resetConnectionForTests(): void {
  connection = null
}
