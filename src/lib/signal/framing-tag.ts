/**
 * FramingTag writer.
 *
 * Captures "outlet X led with framing Y in phase Z" for narrative arc reconstruction.
 * Lightweight — just the tuple (outlet, framing, phase).
 *
 * MIN_SIGNAL: 3+ analyses in a cluster before NarrativeArc considers these tags.
 */

import { prisma } from '@/lib/db'
import { normalizeDomain } from '@/lib/outlet-map'

export interface FramingTagInput {
  outletDomain: string
  storyId: string
  storyClusterId: string | null
  framingAngle: string                // economic | political | humanitarian | security | legal | other
  isDominant: boolean                 // was this the leading framing for this outlet
  storyPhase: string
  isBackfilled?: boolean
}

export async function writeFramingTags(rows: FramingTagInput[]): Promise<{ written: number; failed: number }> {
  if (rows.length === 0) return { written: 0, failed: 0 }

  const data = rows.map((r) => ({
    outletDomain: normalizeDomain(r.outletDomain),
    storyId: r.storyId,
    storyClusterId: r.storyClusterId,
    framingAngle: r.framingAngle,
    isDominant: r.isDominant,
    storyPhase: r.storyPhase,
    isBackfilled: r.isBackfilled ?? false,
  }))

  try {
    await prisma.framingTag.createMany({ data })
    return { written: data.length, failed: 0 }
  } catch (err) {
    console.error('[framingTag] Bulk insert failed:', err instanceof Error ? err.message : err)
    let written = 0
    let failed = 0
    for (const row of data) {
      try {
        await prisma.framingTag.create({ data: row })
        written++
      } catch {
        failed++
      }
    }
    return { written, failed }
  }
}
