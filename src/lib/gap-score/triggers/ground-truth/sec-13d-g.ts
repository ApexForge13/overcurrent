/**
 * T-GT2 — SEC 13D/G activist stake disclosed.
 *
 * Polls EDGAR for new SC 13D and SC 13G filings since the cursor,
 * resolves each target issuer to TrackedEntity, and fires severity 1.0
 * per the Phase 1 addendum A1.4 T-GT2 spec.
 *
 * Direction defaults to +1 (large stake accumulation). Known short-seller
 * activists reverse to -1 via the hand-curated SHORT_SELLER_ACTIVISTS set
 * matched by cleaned filer name. List is conservative — well-known public
 * shorts only. Expand via admin UI in Phase 1c.2b.
 *
 * Cursor persistence shared with T-GT1/T-GT3, per-trigger key.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'
import { pollRecentFilings } from '@/lib/raw-signals/clients/sec-edgar-client'
import { cleanFilerName } from '@/lib/raw-signals/clients/sec-edgar-client'
import {
  resolveFilings,
  logUnmatchedFilings,
} from './sec-entity-resolver'
import {
  readFileDateCursor,
  writeFileDateCursor,
  maxFileDate,
} from './sec-cursor'

const TRIGGER_ID = 'T-GT2'
const MAX_HITS = 50

/**
 * Hand-curated list of well-known short-seller activists. When these
 * entities file 13D/G, the direction flips to -1 because the stake is
 * thesis-driven short-focused, not accumulation-bullish.
 *
 * Expansion policy: admin UI Phase 1c.2b ships a DB-backed version of
 * this list so ops can add names without a code push.
 */
const SHORT_SELLER_ACTIVISTS = new Set<string>(
  [
    'Hindenburg Research',
    'Muddy Waters Capital',
    'Citron Research',
    'Kerrisdale Capital',
    'Spruce Point Capital',
    'Bonitas Research',
    'Wolfpack Research',
    'Grizzly Research',
  ].map((n) => n.toLowerCase()),
)

function isKnownShortActivist(displayName: string): boolean {
  const cleaned = cleanFilerName(displayName).toLowerCase()
  for (const known of SHORT_SELLER_ACTIVISTS) {
    if (cleaned.includes(known)) return true
  }
  return false
}

export async function sec13DGTrigger(ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  const cursor = await readFileDateCursor(ctx.prisma, TRIGGER_ID)

  const outcome = await pollRecentFilings({
    forms: ['SC 13D', 'SC 13G', 'SC 13D/A', 'SC 13G/A'],
    sinceCursor: cursor,
    until: ctx.now,
    maxHits: MAX_HITS,
  })

  if (!outcome.ok) {
    throw new Error(`T-GT2 EDGAR poll failed: ${outcome.errorType}`)
  }

  if (outcome.hits.length === 0) {
    return []
  }

  const { resolved, unresolved } = await resolveFilings(ctx.prisma, outcome.hits)
  await logUnmatchedFilings(ctx.prisma, TRIGGER_ID, unresolved)

  const fires: TriggerFireEvent[] = []
  for (const r of resolved) {
    const firstFiler = r.hit.displayNames[0] ?? ''
    const direction = isKnownShortActivist(firstFiler) ? -1 : 1
    fires.push({
      entityId: r.entityId,
      triggerType: TRIGGER_ID,
      stream: 'ground_truth',
      severity: 1.0,
      metadata: {
        criterion: 'activist_stake',
        formType: r.hit.formType,
        accessionNumber: r.hit.accessionNumber,
        filedAt: r.hit.filedAt,
        entityIdentifier: r.entityIdentifier,
        resolvedBy: r.resolvedBy,
        filer: cleanFilerName(firstFiler),
        direction,
        short_activist_override: direction === -1,
      },
    })
  }

  const nextCursor = maxFileDate(outcome.hits)
  if (nextCursor) {
    await writeFileDateCursor(ctx.prisma, TRIGGER_ID, nextCursor)
  }

  return fires
}
