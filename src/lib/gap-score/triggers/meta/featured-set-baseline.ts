/**
 * T-META2 — Featured-set baseline scan.
 *
 * Scheduled rescan of the ~15 featured entities every 3h (BullMQ repeatable
 * on `gap-score-featured-baseline`). Fires a low-severity (0.3) trigger
 * event for each featured entity regardless of other trigger activity —
 * ensures predictable coverage of core instruments (v2 Part 2.7).
 *
 * The candidate generator's featured-set bypass picks these up and
 * enqueues `gap-score-candidate-compute` jobs. Phase 1a worker's
 * placeholder processor log-and-drops them; Phase 2's real processor will
 * compute Gap Score.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

export async function featuredSetBaselineTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const featured = await ctx.prisma.trackedEntity.findMany({
    where: { isFeatured: true, active: true },
    select: { id: true, identifier: true },
  })

  return featured.map((entity) => ({
    entityId: entity.id,
    triggerType: 'T-META2',
    stream: 'meta' as const,
    severity: 0.3,
    metadata: {
      reason: 'scheduled_featured_set_rescan',
      identifier: entity.identifier,
      scheduled_at: ctx.now.toISOString(),
    },
  }))
}
