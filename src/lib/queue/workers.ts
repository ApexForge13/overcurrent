/**
 * Worker factory.
 *
 * createWorker(name, processor, options?) constructs a BullMQ Worker with the
 * same Redis connection and prefix as the Queue factory. Applying the prefix
 * to BOTH sides is critical — a prefix mismatch would mean workers silently
 * consume from the wrong namespace and production jobs could run against
 * preview data, or vice versa. queue-factories.test.ts has an explicit
 * regression test for this.
 *
 * The factory does NOT maintain a registry of workers. Callers (pipeline-
 * service/worker.ts, tests) hold the references and are responsible for
 * closing them on shutdown. This is intentional: a process may want to
 * construct multiple workers for the same queue at different concurrency
 * levels, and a singleton registry would fight that use case.
 *
 * Concurrency is NOT given a default here — callers must specify it. The
 * right value is per-queue domain knowledge that belongs in the worker host,
 * not in the factory.
 */

import { Worker, type Processor, type WorkerOptions } from 'bullmq'
import { getRedisConnection, getQueuePrefix } from './connection'
import type { QueueName } from './names'

export interface CreateWorkerOptions extends Partial<WorkerOptions> {
  concurrency: number
}

export function createWorker<TData = unknown, TResult = unknown>(
  name: QueueName,
  processor: Processor<TData, TResult>,
  options: CreateWorkerOptions,
): Worker<TData, TResult> {
  return new Worker<TData, TResult>(name, processor, {
    connection: getRedisConnection(),
    prefix: getQueuePrefix(),
    ...options,
  })
}
