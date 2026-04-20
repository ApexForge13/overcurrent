/**
 * Canonical error-row shape for ALL raw-signal runners.
 *
 * When a runner hits an unrecoverable error, it writes a RawSignalLayer row with
 * confidenceLevel='unavailable' and rawContent shaped as a RawSignalError.
 * Downstream consumers (Phase 11 entity dossier, /admin/signals, case-study
 * generator, EntitySignalIndex post-hook) filter and render by discriminating
 * on rawContent.errorType — TypeScript narrows per-variant fields automatically.
 *
 * VERSIONING: every payload carries errorVersion: 1. When the shape evolves,
 * bump the literal and add a renderer branch. NEVER mutate a released version
 * in place — the Phase 11 renderer relies on version gating to stay stable
 * across shape migrations.
 *
 * rawSignalQueueId is carried on every variant so Phase 11's "what went wrong
 * with this queue entry" is a single FK lookup rather than a timestamp
 * reconstruction. clusterEntities is an optional denormalization of the
 * upstream cluster's entities — only populate when the renderer would
 * otherwise need a join (Phase 11 error-feed view renders hundreds of rows
 * at once; join-per-row is the first perf problem).
 *
 * DO NOT invent ad-hoc error fields in individual runners. Extend this union
 * here or use one of the existing variants.
 *
 * serialization_failed is NOT in the public union — it can only be produced
 * internally by safeErrorRow when the real payload fails to JSON.stringify.
 * Consumers that render error rows must still handle the possibility (guard
 * on typeof errorType === 'string' or check the runtime value), but the
 * TypeScript union deliberately excludes it so call sites cannot construct it.
 */

import type { IntegrationResult } from './runner'

export const ERROR_VERSION = 1 as const
export const MAX_ERROR_MESSAGE_LENGTH = 2000

// Shared fields on every RawSignalError variant. Intersected with the
// discriminator union below so TypeScript still narrows on errorType
// while common fields stay DRY at the source.
type CommonErrorFields = {
  errorVersion: typeof ERROR_VERSION
  rawSignalQueueId?: string
  /** Optional denormalization of cluster entities for fast dossier rendering.
   *  Only populate when the renderer would otherwise need a join. */
  clusterEntities?: string[]
  message: string
}

export type RawSignalError =
  | (CommonErrorFields & {
      errorType: 'prisma_query_failed'
      prismaCode?: string          // e.g. 'P2002' (unique violation), 'P1001' (connection)
    })
  | (CommonErrorFields & {
      errorType: 'external_api_error'
      provider: string             // 'polygon' | 'pacer' | 'courtlistener' | 'twitter' | …
      statusCode?: number
    })
  | (CommonErrorFields & {
      errorType: 'resolution_failed'
      attemptedKey: string
    })
  | (CommonErrorFields & {
      errorType: 'timeout'
      provider: string
      timeoutMs: number
    })
  | (CommonErrorFields & {
      errorType: 'rate_limited'
      provider: string
      retryAfterSec?: number
    })
  | (CommonErrorFields & {
      errorType: 'auth_failed'
      provider: string
    })
  | (CommonErrorFields & {
      errorType: 'parse_error'
      provider: string
    })
  | (CommonErrorFields & {
      errorType: 'unknown'
    })

export type RawSignalErrorType = RawSignalError['errorType']

/**
 * Never-throwing stringify. Pass anything (Error, string, object, bigint, undefined, null).
 * Truncates with '…[truncated]' suffix when longer than maxLen.
 * Guard the convention in code so call sites can't drift — if you find
 * yourself writing .slice(0, N) on an error message elsewhere, route it
 * through here instead.
 */
export function safeStringify(raw: unknown, maxLen: number = MAX_ERROR_MESSAGE_LENGTH): string {
  let str: string
  try {
    if (raw instanceof Error) str = raw.message
    else if (typeof raw === 'string') str = raw
    else str = JSON.stringify(raw)
  } catch {
    return '[error message unserializable]'
  }
  if (typeof str !== 'string') str = String(str)
  return str.length > maxLen ? str.slice(0, maxLen) + '…[truncated]' : str
}

/**
 * Build a full IntegrationResult error row with double-fault protection.
 * If the payload itself fails to serialize (circular field, etc.), falls
 * back to an internal serialization_failed literal so the runner STILL
 * writes a row — the "every cluster gets a RawSignalLayer row" invariant
 * survives even when the error itself is pathological.
 *
 * serialization_failed is an internal-only shape; it is deliberately NOT in
 * the exported RawSignalError union so call sites cannot construct one.
 */
export function safeErrorRow(params: {
  error: RawSignalError
  signalSource: string
  captureDate: Date
  haikuSummary: string
}): IntegrationResult {
  let rawContent: Record<string, unknown>
  try {
    JSON.stringify(params.error)
    rawContent = params.error as unknown as Record<string, unknown>
  } catch {
    // Internal-only fallback shape — not part of the exported union.
    const fallback = {
      errorVersion: ERROR_VERSION,
      errorType: 'serialization_failed' as const,
      rawSignalQueueId: params.error.rawSignalQueueId,
      message: 'Error row itself failed to serialize (likely circular reference)',
    }
    rawContent = fallback as unknown as Record<string, unknown>
  }
  return {
    rawContent,
    haikuSummary: params.haikuSummary,
    signalSource: params.signalSource,
    captureDate: params.captureDate,
    coordinates: null,
    divergenceFlag: false,
    divergenceDescription: null,
    confidenceLevel: 'unavailable',
  }
}
