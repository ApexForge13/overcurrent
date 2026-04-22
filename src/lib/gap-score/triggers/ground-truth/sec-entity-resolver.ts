/**
 * Resolve SEC filing hits to TrackedEntity rows.
 *
 * Order of preference for matching:
 *   1. Exact CIK match against TrackedEntity.providerIds.cik
 *      (most reliable — SEC's own identifier)
 *   2. Ticker match against TrackedEntity.identifier
 *      (EDGAR hits include `tickers` on some form types but not others)
 *
 * Unresolved hits are logged to CostLog with operation='sec-unmatched-filing'
 * for admin review and registry expansion. This matches the Phase 1c.1
 * decision to track audit-trail rows for data flagging.
 */

import type { PrismaClient } from '@prisma/client'
import type { SecFilingHit } from '@/lib/raw-signals/clients/sec-edgar-client'

export interface ResolvedFiling {
  hit: SecFilingHit
  entityId: string
  entityIdentifier: string
  /** Which field matched — useful for metadata debugging. */
  resolvedBy: 'cik' | 'ticker'
}

/**
 * Batch-resolve filings. Returns two arrays: resolved (entity found) and
 * unresolved (neither CIK nor ticker matched any TrackedEntity).
 */
export async function resolveFilings(
  prisma: PrismaClient,
  hits: SecFilingHit[],
): Promise<{ resolved: ResolvedFiling[]; unresolved: SecFilingHit[] }> {
  if (hits.length === 0) return { resolved: [], unresolved: [] }

  // Collect distinct CIKs + tickers across all hits, then one bulk query.
  const cikSet = new Set<string>()
  const tickerSet = new Set<string>()
  for (const h of hits) {
    for (const c of h.ciks) if (c) cikSet.add(c.replace(/^0+/, '') || '0')
    for (const t of h.tickers) if (t) tickerSet.add(t.toUpperCase())
  }

  // First pass: lookup by identifier = ticker (direct equality). Registry
  // stores identifiers like "AAPL" not "aapl", so uppercase normalize.
  const tickerMatches = tickerSet.size
    ? await prisma.trackedEntity.findMany({
        where: { identifier: { in: Array.from(tickerSet) }, active: true },
        select: { id: true, identifier: true, providerIds: true },
      })
    : []

  const tickerIndex = new Map<string, (typeof tickerMatches)[number]>()
  for (const t of tickerMatches) tickerIndex.set(t.identifier.toUpperCase(), t)

  // Second pass: lookup by providerIds.cik via raw query. Prisma doesn't
  // support direct Json value equality against an inner key in a typed
  // findMany(), so fetch candidates and filter client-side. Scoped by the
  // set of CIKs we care about via providerIds -> cik search in each row.
  // For the seed data scale (≤15K entities) this is fine; if registry
  // grows to 100K+, move to a functional GIN index + raw query.
  let cikMatches: Array<{ id: string; identifier: string; providerIds: unknown }> = []
  if (cikSet.size > 0) {
    // Small query optimization: providerIds is a JSONB column. Use any
    // match — the unused rows are filtered client-side by the CIK set.
    // In practice this filters to ~equity-only rows since only equities
    // carry a `cik` field.
    const allWithCik = await prisma.trackedEntity.findMany({
      where: { active: true, category: 'equity' },
      select: { id: true, identifier: true, providerIds: true },
    })
    cikMatches = allWithCik.filter((e) => {
      const pids = e.providerIds as { cik?: string } | null
      if (!pids?.cik) return false
      const normalized = pids.cik.replace(/^0+/, '') || '0'
      return cikSet.has(normalized)
    })
  }

  const cikIndex = new Map<string, (typeof cikMatches)[number]>()
  for (const e of cikMatches) {
    const pids = e.providerIds as { cik?: string } | null
    if (pids?.cik) {
      const normalized = pids.cik.replace(/^0+/, '') || '0'
      cikIndex.set(normalized, e)
    }
  }

  const resolved: ResolvedFiling[] = []
  const unresolved: SecFilingHit[] = []

  for (const hit of hits) {
    // Prefer CIK match.
    let match: { id: string; identifier: string } | null = null
    let resolvedBy: 'cik' | 'ticker' | null = null
    for (const c of hit.ciks) {
      const normalized = (c || '').replace(/^0+/, '') || '0'
      const entity = cikIndex.get(normalized)
      if (entity) {
        match = entity
        resolvedBy = 'cik'
        break
      }
    }
    if (!match) {
      for (const t of hit.tickers) {
        const entity = tickerIndex.get(t.toUpperCase())
        if (entity) {
          match = entity
          resolvedBy = 'ticker'
          break
        }
      }
    }
    if (match && resolvedBy) {
      resolved.push({
        hit,
        entityId: match.id,
        entityIdentifier: match.identifier,
        resolvedBy,
      })
    } else {
      unresolved.push(hit)
    }
  }
  return { resolved, unresolved }
}

/**
 * Log unresolved filings to CostLog for admin review. One row per hit
 * so registry-expansion can query by accession number. Cost=0 since no
 * upstream spend is attributed.
 */
export async function logUnmatchedFilings(
  prisma: PrismaClient,
  triggerId: string,
  unresolved: SecFilingHit[],
): Promise<void> {
  if (unresolved.length === 0) return
  await prisma.costLog.createMany({
    data: unresolved.map((h) => ({
      model: 'trigger_runner',
      agentType: 'trigger_unmatched_filing',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: 'trigger',
      operation: 'sec-unmatched-filing',
      metadata: {
        triggerId,
        accessionNumber: h.accessionNumber,
        formType: h.formType,
        filedAt: h.filedAt,
        displayNames: h.displayNames.slice(0, 3),
        ciks: h.ciks,
        tickers: h.tickers,
      },
    })),
  })
}
