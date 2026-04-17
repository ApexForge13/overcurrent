/**
 * OutletFingerprint aggregation.
 *
 * Rebuilds fingerprint rows from the underlying OutletAppearance + FramingTag +
 * FactOmission event logs. Idempotent — safe to rerun after any analysis.
 *
 * MIN_SIGNAL: 20 appearances before percentages are reliable.
 *             Admin UI shows "Insufficient Data — X/20" badge below threshold.
 */

import { prisma } from '@/lib/db'

export interface FingerprintComputeOptions {
  includeBackfilled?: boolean       // default true
}

/**
 * Recompute fingerprint for a single outlet. Called after each analysis
 * for outlets that appeared in it.
 */
export async function recomputeOutletFingerprint(
  outletId: string,
  options: FingerprintComputeOptions = {},
): Promise<void> {
  const { includeBackfilled = true } = options

  const appearanceFilter = includeBackfilled ? {} : { isBackfilled: false }

  const appearances = await prisma.outletAppearance.findMany({
    where: { outletId, ...appearanceFilter },
    select: {
      signalCategory: true,
      storyPhase: true,
      framingAngle: true,
      wasLeadingFraming: true,
      sourceTypes: true,
      hoursFromFirstDetection: true,
      isBackfilled: true,
    },
  })

  const total = appearances.length
  if (total === 0) {
    // Wipe any existing fingerprint — nothing to compute
    await prisma.outletFingerprint.deleteMany({ where: { outletId } })
    return
  }

  // ── 1. primaryFramingDistribution: {category: {framing: pct}} ──
  const framingByCategory: Record<string, Record<string, number>> = {}
  for (const a of appearances) {
    if (!a.signalCategory || !a.framingAngle) continue
    if (!a.wasLeadingFraming) continue // only "led with" counts as framing signal
    framingByCategory[a.signalCategory] ??= {}
    framingByCategory[a.signalCategory][a.framingAngle] =
      (framingByCategory[a.signalCategory][a.framingAngle] || 0) + 1
  }
  // Normalize to percentages per category
  const primaryFramingDistribution: Record<string, Record<string, number>> = {}
  for (const [cat, frames] of Object.entries(framingByCategory)) {
    const catTotal = Object.values(frames).reduce((s, v) => s + v, 0)
    if (catTotal === 0) continue
    primaryFramingDistribution[cat] = {}
    for (const [frame, count] of Object.entries(frames)) {
      primaryFramingDistribution[cat][frame] = Math.round((count / catTotal) * 100)
    }
  }

  // ── 2. sourceTypePreference: {government, expert, unnamed, other} ──
  const sourceCounts: Record<string, number> = { government: 0, expert: 0, unnamed: 0, other: 0 }
  let sourceSamples = 0
  for (const a of appearances) {
    if (!a.sourceTypes) continue
    let types: string[] = []
    try {
      const parsed = JSON.parse(a.sourceTypes)
      if (Array.isArray(parsed)) types = parsed.map((t) => String(t).toLowerCase())
    } catch {
      continue
    }
    for (const t of types) {
      if (t.includes('govern') || t.includes('official')) sourceCounts.government++
      else if (t.includes('expert') || t.includes('analyst') || t.includes('academic')) sourceCounts.expert++
      else if (t.includes('unnamed') || t.includes('anonymous')) sourceCounts.unnamed++
      else sourceCounts.other++
      sourceSamples++
    }
  }
  const sourceTypePreference: Record<string, number> =
    sourceSamples > 0
      ? Object.fromEntries(Object.entries(sourceCounts).map(([k, v]) => [k, Math.round((v / sourceSamples) * 100)]))
      : {}

  // ── 3. pickupSpeed: {category: avg_hours_from_first_detection} ──
  const pickupByCategory: Record<string, { sum: number; count: number }> = {}
  for (const a of appearances) {
    if (!a.signalCategory || typeof a.hoursFromFirstDetection !== 'number') continue
    pickupByCategory[a.signalCategory] ??= { sum: 0, count: 0 }
    pickupByCategory[a.signalCategory].sum += a.hoursFromFirstDetection
    pickupByCategory[a.signalCategory].count += 1
  }
  const pickupSpeed: Record<string, number> = Object.fromEntries(
    Object.entries(pickupByCategory).map(([cat, { sum, count }]) => [cat, count > 0 ? sum / count : 0]),
  )

  // ── 4. storyCategoryCoverage: {category: count} ──
  const storyCategoryCoverage: Record<string, number> = {}
  for (const a of appearances) {
    if (!a.signalCategory) continue
    storyCategoryCoverage[a.signalCategory] = (storyCategoryCoverage[a.signalCategory] || 0) + 1
  }

  // ── 5. omissionRate: fraction of 60%+ facts this outlet missed ──
  //     Query FactOmission rows and check membership in missedByOutlets / carriedByOutlets
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { domain: true } })
  let omissionRate = 0
  if (outlet) {
    // Build a where clause that applies isBackfilled filter if requested
    const factOmissions = await prisma.factOmission.findMany({
      where: includeBackfilled
        ? { presentInPct: { gte: 60 } }
        : { presentInPct: { gte: 60 }, isBackfilled: false },
      select: { carriedByOutlets: true, missedByOutlets: true },
    })
    let missedCount = 0
    let applicableCount = 0
    for (const fo of factOmissions) {
      let carried: string[] = []
      let missed: string[] = []
      try { carried = JSON.parse(fo.carriedByOutlets) } catch {}
      try { missed = JSON.parse(fo.missedByOutlets) } catch {}
      const wasInStory = carried.includes(outlet.domain) || missed.includes(outlet.domain)
      if (wasInStory) {
        applicableCount++
        if (missed.includes(outlet.domain)) missedCount++
      }
    }
    omissionRate = applicableCount > 0 ? missedCount / applicableCount : 0
  }

  // ── 6. includesBackfilledData flag ──
  const includesBackfilledData = appearances.some((a) => a.isBackfilled)

  // ── Upsert ──
  await prisma.outletFingerprint.upsert({
    where: { outletId },
    create: {
      outletId,
      totalAppearances: total,
      primaryFramingDistribution: JSON.stringify(primaryFramingDistribution),
      sourceTypePreference: JSON.stringify(sourceTypePreference),
      regionalOriginBias: null,
      omissionRate,
      pickupSpeed: JSON.stringify(pickupSpeed),
      storyCategoryCoverage: JSON.stringify(storyCategoryCoverage),
      includesBackfilledData,
      lastComputedAt: new Date(),
    },
    update: {
      totalAppearances: total,
      primaryFramingDistribution: JSON.stringify(primaryFramingDistribution),
      sourceTypePreference: JSON.stringify(sourceTypePreference),
      omissionRate,
      pickupSpeed: JSON.stringify(pickupSpeed),
      storyCategoryCoverage: JSON.stringify(storyCategoryCoverage),
      includesBackfilledData,
      lastComputedAt: new Date(),
    },
  })
}

/**
 * Recompute fingerprints for all outlets that appeared in a given story.
 * Called at the end of signal tracking for each analysis.
 */
export async function recomputeFingerprintsForStory(storyId: string): Promise<number> {
  const outletIds = await prisma.outletAppearance.findMany({
    where: { storyId, outletId: { not: null } },
    select: { outletId: true },
    distinct: ['outletId'],
  })

  let recomputed = 0
  for (const row of outletIds) {
    if (!row.outletId) continue
    try {
      await recomputeOutletFingerprint(row.outletId)
      recomputed++
    } catch (err) {
      console.error(`[fingerprint] Failed for outletId ${row.outletId}:`, err instanceof Error ? err.message : err)
    }
  }
  return recomputed
}
