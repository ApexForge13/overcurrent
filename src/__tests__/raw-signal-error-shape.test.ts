import { describe, it, expect } from 'vitest'
import {
  safeStringify,
  safeErrorRow,
  ERROR_VERSION,
  MAX_ERROR_MESSAGE_LENGTH,
  type RawSignalError,
} from '@/lib/raw-signals/error-shape'

describe('safeStringify', () => {
  it('returns Error.message unchanged when short', () => {
    const err = new Error('DB connection lost')
    expect(safeStringify(err)).toBe('DB connection lost')
  })

  it('returns string input unchanged when short', () => {
    expect(safeStringify('boom')).toBe('boom')
  })

  it('returns "undefined" for undefined input', () => {
    // JSON.stringify(undefined) returns undefined (not a string), so the
    // String(str) coercion path is the one that must produce 'undefined'.
    expect(safeStringify(undefined)).toBe('undefined')
  })

  it('returns "null" for null input', () => {
    expect(safeStringify(null)).toBe('null')
  })

  it('returns empty string for empty-string input', () => {
    expect(safeStringify('')).toBe('')
  })

  it('returns [error message unserializable] for BigInt input (JSON.stringify throws)', () => {
    expect(safeStringify(BigInt(1))).toBe('[error message unserializable]')
  })

  it('returns [error message unserializable] for circular object', () => {
    const c: Record<string, unknown> = {}
    c.self = c
    expect(safeStringify(c)).toBe('[error message unserializable]')
  })

  it('truncates with …[truncated] suffix when > maxLen chars (default 2000)', () => {
    const long = 'x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 1)
    const out = safeStringify(long)
    expect(out.endsWith('…[truncated]')).toBe(true)
    // Body portion before suffix is exactly MAX_ERROR_MESSAGE_LENGTH characters
    expect(out.slice(0, MAX_ERROR_MESSAGE_LENGTH)).toBe('x'.repeat(MAX_ERROR_MESSAGE_LENGTH))
  })

  it('respects custom maxLen argument', () => {
    const input = 'abcdefghijklmnopqrstuvwxyz' // 26 chars
    const out = safeStringify(input, 20)
    expect(out).toBe('abcdefghijklmnopqrst' + '…[truncated]')
  })
})

describe('safeErrorRow', () => {
  const captureDate = new Date('2026-04-20T00:00:00Z')

  it('happy path: returns fully-populated IntegrationResult with error as rawContent', () => {
    const error: RawSignalError = {
      errorVersion: ERROR_VERSION,
      errorType: 'prisma_query_failed',
      message: 'x',
    }
    const row = safeErrorRow({
      error,
      signalSource: 'polygon',
      captureDate,
      haikuSummary: 'Signal unavailable.',
    })
    expect(row.confidenceLevel).toBe('unavailable')
    expect(row.divergenceFlag).toBe(false)
    expect(row.coordinates).toBeNull()
    expect(row.divergenceDescription).toBeNull()
    expect(row.signalSource).toBe('polygon')
    expect(row.captureDate).toBe(captureDate)
    expect(row.haikuSummary).toBe('Signal unavailable.')
    expect(row.rawContent).toEqual(error)
  })

  it('double-fault fallback: emits serialization_failed row when error payload has a circular field', () => {
    // Start from a valid RawSignalError and mutate in a circular field to
    // force JSON.stringify to throw during safeErrorRow's serialization probe.
    const error: RawSignalError = {
      errorVersion: ERROR_VERSION,
      errorType: 'prisma_query_failed',
      rawSignalQueueId: 'queue-123',
      message: 'db down',
    }
    ;(error as Record<string, unknown>).foo = error

    const row = safeErrorRow({
      error,
      signalSource: 'polygon',
      captureDate,
      haikuSummary: 'Signal unavailable.',
    })
    // Row is STILL written (invariant: every cluster gets a row)
    expect(row.confidenceLevel).toBe('unavailable')
    expect(row.signalSource).toBe('polygon')
    const payload = row.rawContent as {
      errorType: string
      errorVersion: number
      rawSignalQueueId?: string
      message: string
    }
    expect(payload.errorType).toBe('serialization_failed')
    expect(payload.errorVersion).toBe(ERROR_VERSION)
    expect(payload.rawSignalQueueId).toBe('queue-123')
    expect(payload.message).toMatch(/failed to serialize/i)
  })

  it('type-narrows per errorType discriminator', () => {
    const e: RawSignalError = {
      errorVersion: ERROR_VERSION,
      errorType: 'external_api_error',
      provider: 'polygon',
      statusCode: 429,
      message: 'rate limited',
    }
    if (e.errorType === 'external_api_error') {
      // TypeScript should narrow — access is type-safe without optional chaining
      expect(e.provider).toBe('polygon')
      expect(e.statusCode).toBe(429)
    }
  })

  it('preserves errorType through all public union variants', () => {
    const variants: RawSignalError[] = [
      { errorVersion: ERROR_VERSION, errorType: 'prisma_query_failed', message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'external_api_error', provider: 'polygon', message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'resolution_failed', attemptedKey: 'AAPL', message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'timeout', provider: 'polygon', timeoutMs: 8000, message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'rate_limited', provider: 'polygon', message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'auth_failed', provider: 'polygon', message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'parse_error', provider: 'polygon', message: 'x' },
      { errorVersion: ERROR_VERSION, errorType: 'unknown', message: 'x' },
    ]
    for (const v of variants) {
      const row = safeErrorRow({
        error: v,
        signalSource: 'test',
        captureDate: new Date('2026-04-20T00:00:00Z'),
        haikuSummary: 'unavailable',
      })
      expect((row.rawContent as { errorType: string }).errorType).toBe(v.errorType)
      expect((row.rawContent as { errorVersion: number }).errorVersion).toBe(ERROR_VERSION)
    }
  })
})
