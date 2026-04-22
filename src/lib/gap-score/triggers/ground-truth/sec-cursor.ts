/**
 * TriggerCursor helper for SEC-poll triggers.
 *
 * Each SEC trigger (T-GT1, T-GT2, T-GT3) owns its own cursor on `file_date`.
 * On scan, the trigger reads the cursor, polls EDGAR for filings newer
 * than it, and (on success) advances the cursor to the max filedAt seen.
 *
 * Per-trigger cursor (not shared) so a Form-4 parser failure doesn't
 * block 13D/G scans from advancing — manifest A2 decision.
 */

import type { PrismaClient } from '@prisma/client'

const CURSOR_TYPE = 'file_date'

export async function readFileDateCursor(
  prisma: PrismaClient,
  triggerId: string,
): Promise<string | undefined> {
  const row = await prisma.triggerCursor.findUnique({
    where: { triggerId_cursorType: { triggerId, cursorType: CURSOR_TYPE } },
    select: { cursorValue: true },
  })
  return row?.cursorValue
}

export async function writeFileDateCursor(
  prisma: PrismaClient,
  triggerId: string,
  cursorValue: string,
): Promise<void> {
  await prisma.triggerCursor.upsert({
    where: { triggerId_cursorType: { triggerId, cursorType: CURSOR_TYPE } },
    create: { triggerId, cursorType: CURSOR_TYPE, cursorValue },
    update: { cursorValue },
  })
}

/**
 * Pick the max filedAt from a batch of hits. Returns undefined when the
 * batch is empty (caller should NOT advance the cursor in that case —
 * leaving it unchanged means the next scan retries the same window).
 */
export function maxFileDate(hits: Array<{ filedAt: string }>): string | undefined {
  if (hits.length === 0) return undefined
  return hits.reduce((max, h) => (h.filedAt > max ? h.filedAt : max), hits[0].filedAt)
}
