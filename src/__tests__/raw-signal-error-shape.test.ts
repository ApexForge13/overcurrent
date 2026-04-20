import { describe, it, expect } from 'vitest'
import {
  truncateErrorMessage,
  buildErrorPayload,
  safeErrorRow,
  MAX_ERROR_MESSAGE_LENGTH,
  type RawSignalErrorPayload,
} from '@/lib/raw-signals/error-shape'

describe('truncateErrorMessage', () => {
  it('returns Error.message unchanged when short', () => {
    const err = new Error('DB connection lost')
    expect(truncateErrorMessage(err)).toBe('DB connection lost')
  })

  it('returns string input unchanged when short', () => {
    expect(truncateErrorMessage('boom')).toBe('boom')
  })

  it('JSON.stringifies non-string / non-Error input', () => {
    expect(truncateErrorMessage({ code: 500, detail: 'upstream' })).toBe(
      '{"code":500,"detail":"upstream"}',
    )
  })

  it('truncates with …[truncated] suffix when > MAX_ERROR_MESSAGE_LENGTH chars', () => {
    const long = 'x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 250)
    const out = truncateErrorMessage(long)
    expect(out.endsWith('…[truncated]')).toBe(true)
    // Body portion before suffix is exactly MAX_ERROR_MESSAGE_LENGTH characters
    expect(out.slice(0, MAX_ERROR_MESSAGE_LENGTH)).toBe('x'.repeat(MAX_ERROR_MESSAGE_LENGTH))
  })

  it('returns [error message unserializable] when JSON.stringify throws (BigInt)', () => {
    // BigInt can't be serialized by JSON.stringify by default → throws TypeError.
    const out = truncateErrorMessage({ big: BigInt(10) })
    expect(out).toBe('[error message unserializable]')
  })
})

describe('buildErrorPayload', () => {
  it('returns {errorType, message, context} when context provided', () => {
    const payload = buildErrorPayload('external_api_error', new Error('oops'), {
      url: 'https://api.example.com',
      status: 502,
    })
    expect(payload.errorType).toBe('external_api_error')
    expect(payload.message).toBe('oops')
    expect(payload.context).toEqual({ url: 'https://api.example.com', status: 502 })
  })

  it('returns {errorType, message} with no context key when context omitted', () => {
    const payload = buildErrorPayload('timeout', 'fetch aborted')
    expect(payload.errorType).toBe('timeout')
    expect(payload.message).toBe('fetch aborted')
    expect('context' in payload).toBe(false)
  })

  it('preserves errorType exactly across the union', () => {
    const types: RawSignalErrorPayload['errorType'][] = [
      'prisma_query_failed',
      'external_api_error',
      'resolution_failed',
      'timeout',
      'rate_limited',
      'auth_failed',
      'parse_error',
      'serialization_failed',
    ]
    for (const t of types) {
      expect(buildErrorPayload(t, 'x').errorType).toBe(t)
    }
  })
})

describe('safeErrorRow', () => {
  const captureDate = new Date('2026-04-20T00:00:00Z')

  it('returns IntegrationResult with confidenceLevel=unavailable', () => {
    const row = safeErrorRow({
      errorType: 'prisma_query_failed',
      err: new Error('db down'),
      signalSource: 'polygon',
      captureDate,
      haikuSummary: 'Signal unavailable.',
    })
    expect(row.confidenceLevel).toBe('unavailable')
  })

  it('passes signalSource, captureDate, haikuSummary through unchanged', () => {
    const row = safeErrorRow({
      errorType: 'external_api_error',
      err: 'bad gateway',
      signalSource: 'pacer',
      captureDate,
      haikuSummary: 'Legal signal unavailable.',
    })
    expect(row.signalSource).toBe('pacer')
    expect(row.captureDate).toBe(captureDate)
    expect(row.haikuSummary).toBe('Legal signal unavailable.')
  })

  it('always sets divergenceFlag=false and coordinates=null', () => {
    const row = safeErrorRow({
      errorType: 'rate_limited',
      err: new Error('429'),
      signalSource: 'social_reddit',
      captureDate,
      haikuSummary: 'Social signal unavailable.',
    })
    expect(row.divergenceFlag).toBe(false)
    expect(row.coordinates).toBeNull()
    expect(row.divergenceDescription).toBeNull()
  })

  it('falls back to serialization_failed when context is circular (double-fault protection)', () => {
    // Build a circular context
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    const row = safeErrorRow({
      errorType: 'prisma_query_failed',
      err: new Error('db down'),
      context: circular,
      signalSource: 'polygon',
      captureDate,
      haikuSummary: 'Signal unavailable.',
    })
    // Row is STILL written (invariant: every cluster gets a row)
    expect(row.confidenceLevel).toBe('unavailable')
    expect(row.signalSource).toBe('polygon')
    const payload = row.rawContent as { errorType: string; message: string }
    expect(payload.errorType).toBe('serialization_failed')
    expect(payload.message).toMatch(/failed to serialize/i)
  })
})
