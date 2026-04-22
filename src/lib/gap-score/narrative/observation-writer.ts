/**
 * Shared helper: batch-write EntityObservation rows from extractions.
 *
 * Relies on EntityObservation's unique (entityId, sourceType, sourceUrl)
 * constraint for idempotent replay — running the same GDELT batch twice
 * produces the same row count. Uses createMany with skipDuplicates so
 * dedup is DB-side and no pre-check is needed.
 */

import type { PrismaClient } from '@prisma/client'

export interface ObservationInput {
  entityId: string
  sourceType: string
  outlet: string | null
  sourceUrl: string
  title: string | null
  engagement: number | null
  observedAt: Date
}

export async function writeObservations(
  prisma: PrismaClient,
  inputs: ObservationInput[],
): Promise<{ attempted: number; inserted: number }> {
  if (inputs.length === 0) return { attempted: 0, inserted: 0 }
  const result = await prisma.entityObservation.createMany({
    data: inputs.map((i) => ({
      entityId: i.entityId,
      sourceType: i.sourceType,
      outlet: i.outlet,
      sourceUrl: i.sourceUrl,
      title: i.title,
      engagement: i.engagement,
      observedAt: i.observedAt,
    })),
    skipDuplicates: true,
  })
  return { attempted: inputs.length, inserted: result.count }
}
