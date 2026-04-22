/**
 * Consensus scrape runner — fetch + upsert orchestration for one indicator.
 *
 * Tries the primary (Investing.com) source first, falls back to Trading
 * Economics on null, upserts MacroRelease, writes CostLog heartbeat per
 * attempt. The worker processor calls this per scheduled indicator.
 */

import type { PrismaClient } from '@prisma/client'
import { scrapeInvestingConsensus } from './investing-calendar'
import { scrapeTEConsensus } from './trading-economics-calendar'
import { upsertConsensus } from './upsert'

export interface ScrapeRunOutcome {
  indicator: string
  status: 'upserted' | 'no_data' | 'error'
  source?: 'investing.com' | 'trading_economics'
  createdNew?: boolean
  error?: string
}

export async function runConsensusScrapeForIndicator(
  prisma: PrismaClient,
  indicator: string,
  releaseDate?: string,
): Promise<ScrapeRunOutcome> {
  try {
    // Primary: Investing.com
    let result = await scrapeInvestingConsensus(indicator, releaseDate)
    // Fallback: Trading Economics
    if (!result) {
      const teResult = await scrapeTEConsensus(indicator, releaseDate)
      if (teResult) {
        result = {
          indicator: teResult.indicator,
          releaseDate: teResult.releaseDate,
          consensusValue: teResult.consensusValue,
          actualValue: teResult.actualValue,
          unit: teResult.unit,
          source: 'investing.com' as const, // coerced — but the upsert writer accepts both
        }
        // Actually use the TE source label. Going explicit via a second var
        // to keep strict typing clean:
        const upsertOutcome = await upsertConsensus(prisma, {
          indicator,
          releaseDate: teResult.releaseDate ?? releaseDate ?? new Date().toISOString().split('T')[0],
          consensusValue: teResult.consensusValue,
          consensusSource: 'trading_economics',
          actualValue: teResult.actualValue,
          unit: teResult.unit,
        })
        await writeScrapeHeartbeat(prisma, indicator, 'upserted', {
          source: 'trading_economics',
          releaseDate: teResult.releaseDate,
          consensusValue: teResult.consensusValue,
          created: upsertOutcome.created,
        })
        return {
          indicator,
          status: 'upserted',
          source: 'trading_economics',
          createdNew: upsertOutcome.created,
        }
      }
    }

    if (!result) {
      await writeScrapeHeartbeat(prisma, indicator, 'no_data', {
        reason: 'both_sources_returned_null',
      })
      return { indicator, status: 'no_data' }
    }

    // Investing.com path
    const upsertOutcome = await upsertConsensus(prisma, {
      indicator,
      releaseDate: result.releaseDate ?? releaseDate ?? new Date().toISOString().split('T')[0],
      consensusValue: result.consensusValue,
      consensusSource: 'investing.com',
      actualValue: result.actualValue,
      unit: result.unit,
    })
    await writeScrapeHeartbeat(prisma, indicator, 'upserted', {
      source: 'investing.com',
      releaseDate: result.releaseDate,
      consensusValue: result.consensusValue,
      created: upsertOutcome.created,
    })
    return {
      indicator,
      status: 'upserted',
      source: 'investing.com',
      createdNew: upsertOutcome.created,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeScrapeHeartbeat(prisma, indicator, 'error', { error: message.slice(0, 500) })
    return { indicator, status: 'error', error: message }
  }
}

async function writeScrapeHeartbeat(
  prisma: PrismaClient,
  indicator: string,
  outcome: ScrapeRunOutcome['status'],
  detail: Record<string, unknown>,
): Promise<void> {
  await prisma.costLog.create({
    data: {
      model: 'consensus_scraper',
      agentType: 'consensus_scrape',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      service: 'consensus',
      operation: 'consensus-scrape-heartbeat',
      metadata: { indicator, outcome, ...detail },
    },
  })
}
