/**
 * Queue factory + registry.
 *
 * getQueue(name) returns a singleton Queue<T> per queue name. Singletons are
 * the right default: BullMQ's Queue holds a Redis connection and event bus —
 * creating two Queues for the same name doubles the overhead with no benefit.
 *
 * The factory is the ONLY place Queue instances are constructed outside of
 * tests. This guarantees every Queue receives:
 *   - the shared Redis connection (via getRedisConnection)
 *   - the environment-scoped prefix (via getQueuePrefix) — MUST match the
 *     prefix applied by createWorker() in workers.ts, or jobs enqueued here
 *     will never be consumed
 *   - DEFAULT_JOB_OPTIONS applied as defaultJobOptions
 *
 * The pair-constraint (prefix must match Worker) is enforced by
 * queue-factories.test.ts — both factories read from the same getter, so if
 * QUEUE_PREFIX changes at runtime (via env), both update in lock-step.
 */

import { Queue, type QueueOptions } from 'bullmq'
import { getRedisConnection, getQueuePrefix } from './connection'
import { DEFAULT_JOB_OPTIONS } from './default-options'
import type { QueueName } from './names'

const registry = new Map<QueueName, Queue>()

export function getQueue<TData = unknown, TResult = unknown>(
  name: QueueName,
  overrides?: Partial<QueueOptions>,
): Queue<TData, TResult> {
  const existing = registry.get(name)
  if (existing) return existing as Queue<TData, TResult>

  const queue = new Queue<TData, TResult>(name, {
    connection: getRedisConnection(),
    prefix: getQueuePrefix(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...overrides,
  })

  registry.set(name, queue as Queue)
  return queue
}

/**
 * Close all registered queues. Used in worker shutdown + test teardown.
 * Idempotent — safe to call when the registry is empty.
 */
export async function closeAllQueues(): Promise<void> {
  const queues = Array.from(registry.values())
  registry.clear()
  await Promise.all(queues.map((q) => q.close()))
}

/** Test-only: reset the registry without closing queues. */
export function __resetRegistryForTests(): void {
  registry.clear()
}
