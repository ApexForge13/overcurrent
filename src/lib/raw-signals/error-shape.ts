/**
 * Canonical error-row shape for ALL raw-signal runners.
 *
 * When a runner encounters an unrecoverable error during signal fetch,
 * it writes a RawSignalLayer row with confidenceLevel='unavailable' and
 * rawContent shaped as RawSignalErrorPayload. Downstream consumers
 * (Phase 11 entity dossier, /admin/signals UI, case-study generator,
 * EntitySignalIndex post-hook) filter + display error rows uniformly
 * by reading rawContent.errorType.
 *
 * DO NOT invent ad-hoc error fields in individual runners. Use buildErrorPayload
 * or safeErrorRow. Adding a new errorType means extending the union here
 * and documenting what triggers it.
 */

import type { IntegrationResult } from './runner'

export type RawSignalErrorType =
  | 'prisma_query_failed'      // DB query threw (timeout, connection, deadlock, etc.)
  | 'external_api_error'       // Non-2xx response from an external provider
  | 'resolution_failed'        // Lookup mapping (entity → ticker, channel → handle) produced zero results AND the provider call errored
  | 'timeout'                  // Request exceeded our client-side timeout
  | 'rate_limited'             // Provider returned 429 / rate-limit signal
  | 'auth_failed'              // Missing / invalid / expired credentials
  | 'parse_error'              // Response returned 200 but body did not parse
  | 'serialization_failed'     // The error row itself failed to serialize (double-fault)

export const MAX_ERROR_MESSAGE_LENGTH = 500

export interface RawSignalErrorPayload {
  errorType: RawSignalErrorType
  message: string                              // Truncated to MAX_ERROR_MESSAGE_LENGTH
  context?: Record<string, unknown>            // Optional structured context (cluster entities, URL, status code)
}

export function truncateErrorMessage(raw: unknown): string {
  try {
    let str: string
    if (raw instanceof Error) str = raw.message
    else if (typeof raw === 'string') str = raw
    else str = JSON.stringify(raw)
    if (str.length <= MAX_ERROR_MESSAGE_LENGTH) return str
    return str.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '…[truncated]'
  } catch {
    return '[error message unserializable]'
  }
}

export function buildErrorPayload(
  errorType: RawSignalErrorType,
  err: unknown,
  context?: Record<string, unknown>,
): RawSignalErrorPayload {
  return {
    errorType,
    message: truncateErrorMessage(err),
    ...(context !== undefined ? { context } : {}),
  }
}

/**
 * Build a full IntegrationResult error row with double-fault protection.
 * If the context itself fails to serialize (circular ref, too-big BigInt, etc.),
 * falls back to a serialization_failed payload so the runner STILL writes a row
 * — preserving the "every cluster gets a row" invariant.
 */
export function safeErrorRow(params: {
  errorType: RawSignalErrorType
  err: unknown
  context?: Record<string, unknown>
  signalSource: string
  captureDate: Date
  haikuSummary: string
}): IntegrationResult {
  let rawContent: Record<string, unknown>
  try {
    const payload = buildErrorPayload(params.errorType, params.err, params.context)
    // Force-test serialization: if context is circular, this throws here
    JSON.stringify(payload)
    rawContent = payload as unknown as Record<string, unknown>
  } catch {
    const fallback: RawSignalErrorPayload = {
      errorType: 'serialization_failed',
      message: 'Error row itself failed to serialize (likely circular context)',
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
