/**
 * T-GT3 — SEC 8-K material event.
 *
 * Polls EDGAR for 8-K filings since the cursor, resolves to TrackedEntity,
 * then extracts Item codes from the summary (if present) to apply the
 * Phase 1 addendum A1.4 severity ladder:
 *
 *   Item 1.01 (material agreement):         severity 0.7
 *   Item 1.02 (material termination):       severity 0.8
 *   Item 2.01 (completion of acquisition):  severity 0.8
 *   Item 2.03 (material obligation):        severity 0.7
 *   Item 4.02 (non-reliance on financials): severity 1.0 (AUDITOR WARNING)
 *   Item 5.02 (exec change):                severity 0.6
 *
 * Direction: Item 4.02 → -1 (always bearish — auditor flag). Other items
 * defer to Phase 2 LLM sentiment scoring and emit direction=0.
 *
 * Item code extraction: EDGAR full-text `_source.xsl` summary and the
 * headline-ish text embedded in display_names sometimes include item
 * codes like "Item 4.02". We regex them out; hits with no recognizable
 * item codes get a default item=null fire with severity 0.5 so the
 * 8-K at least appears in the trigger stream for downstream inspection.
 * That default is deliberately moderate — avoids pyramiding noise from
 * 8-Ks that aren't item-parseable.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { pollRecentFilings, type SecFilingHit } from '@/lib/raw-signals/clients/sec-edgar-client'
import {
  resolveFilings,
  logUnmatchedFilings,
} from './sec-entity-resolver'
import {
  readFileDateCursor,
  writeFileDateCursor,
  maxFileDate,
} from './sec-cursor'

const TRIGGER_ID = 'T-GT3'
const MAX_HITS = 200
const FALLBACK_SEVERITY = 0.5

interface ItemSpec {
  severity: number
  direction: number // 0 = ambiguous, -1 = always bearish
  label: string
}

const ITEM_MAP: Record<string, ItemSpec> = {
  '1.01': { severity: 0.7, direction: 0, label: 'material_agreement' },
  '1.02': { severity: 0.8, direction: 0, label: 'material_termination' },
  '2.01': { severity: 0.8, direction: 0, label: 'completion_of_acquisition' },
  '2.03': { severity: 0.7, direction: 0, label: 'material_obligation' },
  '4.02': { severity: 1.0, direction: -1, label: 'non_reliance_on_financials' },
  '5.02': { severity: 0.6, direction: 0, label: 'exec_change' },
}

/**
 * Extract recognized 8-K item codes from the EDGAR summary text. Returns
 * the set of matched item codes (strings like "4.02"). When no items are
 * detected, returns empty — caller uses the fallback severity.
 */
export function extractItemCodes(hit: SecFilingHit): string[] {
  const haystack = [hit.summary ?? '', ...hit.displayNames].join(' | ')
  const matches = new Set<string>()
  // Pattern: "Item 4.02" or "Item 4.02," or "ITEM4.02" variants
  const re = /item\s*(\d+\.\d{2})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(haystack)) !== null) {
    const code = m[1]
    if (ITEM_MAP[code]) matches.add(code)
  }
  return Array.from(matches)
}

export async function sec8KTrigger(ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  const cursor = await readFileDateCursor(ctx.prisma, TRIGGER_ID)

  const outcome = await pollRecentFilings({
    forms: ['8-K', '8-K/A'],
    sinceCursor: cursor,
    until: ctx.now,
    maxHits: MAX_HITS,
  })

  if (!outcome.ok) {
    throw new Error(`T-GT3 EDGAR poll failed: ${outcome.errorType}`)
  }

  if (outcome.hits.length === 0) {
    return []
  }

  const { resolved, unresolved } = await resolveFilings(ctx.prisma, outcome.hits)
  await logUnmatchedFilings(ctx.prisma, TRIGGER_ID, unresolved)

  const fires: TriggerFireEvent[] = []
  for (const r of resolved) {
    const itemCodes = extractItemCodes(r.hit)
    if (itemCodes.length === 0) {
      // Fire at fallback severity so the 8-K shows up, but flagged as
      // unknown-item.
      fires.push({
        entityId: r.entityId,
        triggerType: TRIGGER_ID,
        stream: 'ground_truth',
        severity: FALLBACK_SEVERITY,
        metadata: {
          criterion: '8k_no_item_parsed',
          accessionNumber: r.hit.accessionNumber,
          formType: r.hit.formType,
          filedAt: r.hit.filedAt,
          entityIdentifier: r.entityIdentifier,
          resolvedBy: r.resolvedBy,
          item_codes: [],
          direction: 0,
        },
      })
      continue
    }
    // If multiple items on one 8-K, take the max-severity one — captures
    // the dominant signal. Item 4.02 always wins when present.
    const dominant = itemCodes
      .map((c) => ({ code: c, spec: ITEM_MAP[c] }))
      .sort((a, b) => b.spec.severity - a.spec.severity)[0]
    fires.push({
      entityId: r.entityId,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity: dominant.spec.severity,
      metadata: {
        criterion: `8k_item_${dominant.code}`,
        accessionNumber: r.hit.accessionNumber,
        formType: r.hit.formType,
        filedAt: r.hit.filedAt,
        entityIdentifier: r.entityIdentifier,
        resolvedBy: r.resolvedBy,
        item_codes: itemCodes,
        dominant_item: dominant.code,
        item_label: dominant.spec.label,
        direction: dominant.spec.direction,
      },
    })
  }

  const nextCursor = maxFileDate(outcome.hits)
  if (nextCursor) {
    await writeFileDateCursor(ctx.prisma, TRIGGER_ID, nextCursor)
  }

  return fires
}
