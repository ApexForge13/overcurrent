/**
 * Centralized CostLog heartbeat for services disabled by missing env keys.
 *
 * Per Phase 1c.2b manifest scope #10: when an API key is missing, the
 * trigger logs a heartbeat to CostLog once per hour so operators see the
 * dormant state. When the key is provisioned, no code change needed —
 * triggers start firing.
 *
 * Dedup: uses the `createdAt` column of the most-recent row for this
 * service+operation key. If the last heartbeat was within the past
 * dedupWindowHours, skip. Cheap single-row read.
 */

import type { PrismaClient } from '@prisma/client'

const DEFAULT_DEDUP_WINDOW_HOURS = 1

export async function writeMissingKeyHeartbeat(
  prisma: PrismaClient,
  serviceName: string,
  envVarName: string,
  dedupWindowHours = DEFAULT_DEDUP_WINDOW_HOURS,
): Promise<{ wrote: boolean }> {
  const cutoff = new Date(Date.now() - dedupWindowHours * 60 * 60 * 1000)
  const recent = await prisma.costLog.findFirst({
    where: {
      service: serviceName,
      operation: 'disabled:missing-key',
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  })
  if (recent) return { wrote: false }

  await prisma.costLog.create({
    data: {
      model: 'trigger_runner',
      agentType: 'disabled_heartbeat',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: serviceName,
      operation: 'disabled:missing-key',
      metadata: { envVar: envVarName, reason: 'env_key_missing' },
    },
  })
  return { wrote: true }
}
