/**
 * Trigger dispatcher.
 *
 * Takes a trigger definition + implementation + context, runs the
 * implementation, writes each fire to TriggerEvent. Short-circuits on
 * disabled triggers. Swallows per-trigger errors and logs to CostLog
 * so one broken trigger doesn't cascade-kill the scan.
 */

import type { PrismaClient } from '@prisma/client'
import type { TriggerContext, TriggerDefinition, TriggerFireEvent, TriggerFunction } from './types'
import {
  isTriggerEnabledWithFallback,
  getThresholdOverrides,
} from './enablement'

export interface DispatchResult {
  triggerType: string
  status: 'disabled' | 'fired' | 'no_fire' | 'error'
  fireCount: number
  durationMs: number
  error?: string
}

export async function dispatchTrigger(
  definition: TriggerDefinition,
  implementation: TriggerFunction,
  ctx: TriggerContext,
): Promise<DispatchResult> {
  const start = Date.now()

  const enabled = await isTriggerEnabledWithFallback(ctx.prisma, definition.id)
  if (!enabled) {
    return {
      triggerType: definition.id,
      status: 'disabled',
      fireCount: 0,
      durationMs: 0,
    }
  }

  // Inject threshold overrides (if any) into the context so trigger
  // implementations that support overrides merge them with defaults.
  const thresholds = await getThresholdOverrides(ctx.prisma, definition.id)
  const enrichedCtx: TriggerContext = { ...ctx, thresholds }

  try {
    const fires = await implementation(enrichedCtx)
    for (const fire of fires) {
      await writeTriggerEvent(ctx.prisma, fire)
    }
    return {
      triggerType: definition.id,
      status: fires.length > 0 ? 'fired' : 'no_fire',
      fireCount: fires.length,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Log the error to CostLog as an infrastructure signal — separate from
    // trigger fires. Cost=0 since no LLM/API cost attached to the failure.
    try {
      await ctx.prisma.costLog.create({
        data: {
          model: 'trigger_runner',
          agentType: 'trigger_runner_error',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          service: 'trigger',
          operation: `dispatch:${definition.id}`,
          metadata: {
            error: message.slice(0, 500),
            durationMs: Date.now() - start,
          },
        },
      })
    } catch {
      // Swallow — logging failure shouldn't mask the original error in the return.
    }
    return {
      triggerType: definition.id,
      status: 'error',
      fireCount: 0,
      durationMs: Date.now() - start,
      error: message,
    }
  }
}

async function writeTriggerEvent(prisma: PrismaClient, fire: TriggerFireEvent): Promise<void> {
  await prisma.triggerEvent.create({
    data: {
      entityId: fire.entityId,
      triggerType: fire.triggerType,
      stream: fire.stream,
      severity: fire.severity,
      metadata: fire.metadata as object,
    },
  })
}
