/**
 * Write consensus scrape results to MacroRelease.
 *
 * Idempotent: upsert by (indicator, releaseDate). Creates a fresh row
 * when the release hasn't posted yet (pre-release scrape captures
 * forecast before the actual); updates an existing row when we're
 * backfilling consensus on a row that already has an actual.
 *
 * Computes surprise + surpriseZscore whenever both actualValue and
 * consensusValue end up populated on the same row.
 */

import type { PrismaClient } from '@prisma/client'

export interface ConsensusUpsertInput {
  indicator: string
  releaseDate: string // ISO date (YYYY-MM-DD)
  consensusValue: number | null
  consensusSource: 'investing.com' | 'trading_economics'
  actualValue?: number | null
  unit?: string | null
}

export interface ConsensusUpsertOutcome {
  created: boolean
  surpriseComputed: boolean
}

export async function upsertConsensus(
  prisma: PrismaClient,
  input: ConsensusUpsertInput,
): Promise<ConsensusUpsertOutcome> {
  // releaseDate comes in as YYYY-MM-DD; normalize to a midnight-UTC Date
  // for the DB's DateTime column.
  const date = new Date(`${input.releaseDate}T00:00:00Z`)

  const existing = await prisma.macroRelease.findUnique({
    where: { indicator_releaseDate: { indicator: input.indicator, releaseDate: date } },
    select: {
      id: true,
      actualValue: true,
      unit: true,
      consensusValue: true,
    },
  })

  // Decide final values — don't overwrite an existing consensus with null,
  // and don't overwrite an existing actual with null either.
  const consensusFinal = input.consensusValue ?? existing?.consensusValue ?? null
  const actualFinal = input.actualValue ?? existing?.actualValue ?? null
  const unitFinal = input.unit ?? existing?.unit ?? 'unknown'

  // Compute surprise + z-score when both sides populated.
  let surprise: number | null = null
  let surpriseZscore: number | null = null
  if (actualFinal !== null && consensusFinal !== null) {
    surprise = actualFinal - consensusFinal
    const config = await prisma.macroIndicatorConfig.findUnique({
      where: { indicator: input.indicator },
      select: { historicalStddev: true },
    })
    if (config && config.historicalStddev > 0) {
      surpriseZscore = surprise / config.historicalStddev
    }
  }

  if (!existing) {
    await prisma.macroRelease.create({
      data: {
        indicator: input.indicator,
        releaseDate: date,
        consensusValue: consensusFinal,
        consensusSource: input.consensusSource,
        consensusScraped: new Date(),
        actualValue: actualFinal,
        surprise,
        surpriseZscore,
        unit: unitFinal,
      },
    })
    return { created: true, surpriseComputed: surpriseZscore !== null }
  }

  await prisma.macroRelease.update({
    where: { id: existing.id },
    data: {
      consensusValue: consensusFinal,
      consensusSource: input.consensusSource,
      consensusScraped: new Date(),
      actualValue: actualFinal,
      surprise,
      surpriseZscore,
      unit: unitFinal,
    },
  })
  return { created: false, surpriseComputed: surpriseZscore !== null }
}
