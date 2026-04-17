import type { PrismaClient } from '@prisma/client'

/**
 * Bump UmbrellaArc counters for a newly filed analysis.
 *
 * Called from inside the Story-creation transaction so counters stay consistent.
 * Rules:
 *   - totalAnalyses  += 1 always (any Story filed under the umbrella)
 *   - storyArcCount  += 1 only if analysisType === 'new_arc'
 *   - oneOffCount    += 1 if analysisType in ('umbrella_tagged', 'standalone')
 *                      (standalone counts here only if filed under an umbrella,
 *                       which is an edge case with a confirmation prompt in the UI)
 *   - arc_rerun      → totalAnalyses only, no other counter
 *   - firstAnalysisAt → set only if currently null (first-ever analysis)
 *   - lastAnalysisAt  → always set to now
 */
export async function bumpUmbrellaCounters(
  tx: Pick<PrismaClient, 'umbrellaArc'>,
  umbrellaArcId: string,
  analysisType: string | null | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!umbrellaArcId) return

  // Pull current state to decide firstAnalysisAt
  const current = await tx.umbrellaArc.findUnique({
    where: { id: umbrellaArcId },
    select: { firstAnalysisAt: true },
  })
  if (!current) {
    // Umbrella was deleted between Story.create and counter bump — nothing to do
    return
  }

  const increments: { totalAnalyses: number; storyArcCount?: number; oneOffCount?: number } = {
    totalAnalyses: 1,
  }
  if (analysisType === 'new_arc') increments.storyArcCount = 1
  if (analysisType === 'umbrella_tagged' || analysisType === 'standalone') {
    increments.oneOffCount = 1
  }

  await tx.umbrellaArc.update({
    where: { id: umbrellaArcId },
    data: {
      totalAnalyses: { increment: increments.totalAnalyses },
      ...(increments.storyArcCount
        ? { storyArcCount: { increment: increments.storyArcCount } }
        : {}),
      ...(increments.oneOffCount
        ? { oneOffCount: { increment: increments.oneOffCount } }
        : {}),
      firstAnalysisAt: current.firstAnalysisAt ?? now,
      lastAnalysisAt: now,
    },
  })
}
