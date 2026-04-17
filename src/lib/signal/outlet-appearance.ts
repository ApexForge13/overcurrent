/**
 * OutletAppearance writer.
 *
 * One row per outlet per analysis. Drives the OutletFingerprint aggregation.
 * Immutable — rows are never updated, only inserted.
 *
 * MIN_SIGNAL: no threshold — every appearance is valid data.
 *             Fingerprint aggregation needs 20+ appearances per outlet.
 */

import { prisma } from '@/lib/db'
import { normalizeDomain } from '@/lib/outlet-map'

export interface AppearanceInput {
  outletDomain: string            // raw or normalized; we'll normalize
  storyId: string
  storyClusterId: string | null
  signalCategory: string | null
  storyPhase: string              // first_wave | development | ...
  framingAngle?: string | null    // economic | political | humanitarian | ...
  wasLeadingFraming?: boolean
  sourceTypes?: string[] | null
  publishedAt?: Date | null
  hoursFromFirstDetection?: number | null
  isBackfilled?: boolean
}

/**
 * Bulk-insert OutletAppearance rows for every outlet in an analysis.
 * Runs after the main story save. Never blocks pipeline on errors —
 * signal tracking failures must not corrupt user-facing analysis results.
 */
export async function writeOutletAppearances(rows: AppearanceInput[]): Promise<{ written: number; failed: number }> {
  if (rows.length === 0) return { written: 0, failed: 0 }

  // Resolve outletId by domain lookup. Unknown domains get null outletId
  // but are still written with the outletDomain for future retro-resolution.
  const domains = [...new Set(rows.map((r) => normalizeDomain(r.outletDomain)))]
  const outletLookup = new Map<string, string>()
  try {
    const outlets = await prisma.outlet.findMany({
      where: { domain: { in: domains } },
      select: { id: true, domain: true },
    })
    for (const o of outlets) outletLookup.set(o.domain, o.id)
  } catch (err) {
    console.warn('[appearance] Outlet lookup failed, continuing with null outletIds:', err instanceof Error ? err.message : err)
  }

  // Validate Date objects — new Date("invalid") returns a truthy Invalid Date
  // that passes the ?? null guard but crashes Prisma inserts.
  function validDate(d: Date | null | undefined): Date | null {
    if (!d) return null
    if (Number.isNaN(d.getTime())) return null
    return d
  }
  function validNumber(n: number | null | undefined): number | null {
    if (n === null || n === undefined) return null
    if (Number.isNaN(n) || !Number.isFinite(n)) return null
    return n
  }

  const data = rows.map((r) => ({
    outletId: outletLookup.get(normalizeDomain(r.outletDomain)) ?? null,
    outletDomain: normalizeDomain(r.outletDomain),
    storyId: r.storyId,
    storyClusterId: r.storyClusterId,
    signalCategory: r.signalCategory,
    storyPhase: r.storyPhase,
    framingAngle: r.framingAngle ?? null,
    wasLeadingFraming: r.wasLeadingFraming ?? false,
    sourceTypes: r.sourceTypes ? JSON.stringify(r.sourceTypes) : null,
    publishedAt: validDate(r.publishedAt),
    hoursFromFirstDetection: validNumber(r.hoursFromFirstDetection),
    isBackfilled: r.isBackfilled ?? false,
  }))

  try {
    await prisma.outletAppearance.createMany({ data })
    return { written: data.length, failed: 0 }
  } catch (err) {
    console.error('[appearance] Bulk insert failed:', err instanceof Error ? err.message : err)
    // Fall back to individual inserts — returns partial progress rather than 0
    let written = 0
    let failed = 0
    for (const row of data) {
      try {
        await prisma.outletAppearance.create({ data: row })
        written++
      } catch {
        failed++
      }
    }
    return { written, failed }
  }
}
