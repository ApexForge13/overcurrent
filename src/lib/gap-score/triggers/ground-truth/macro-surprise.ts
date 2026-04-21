/**
 * T-GT9 — Macro surprise trigger.
 *
 * Fires on MacroRelease rows where:
 *   - consensusValue is non-null (else "surprise" is undefined)
 *   - actualValue is non-null
 *   - |actual − consensus| / historicalStddev > 1.0 (surprise z-score > 1σ)
 *
 * Applies the indicator's directionMapping to emit fires per affected
 * TrackedEntity. Direction is encoded in metadata.direction (+1 / -1).
 *
 * PHASE 1c.1 STATUS: dormant. Consensus scraping lands in Phase 1c.2, so
 * every MacroRelease row has consensusValue=null and the trigger returns
 * []. Code is live — it starts firing automatically the moment 1c.2 seeds
 * the first consensus value.
 *
 * The trigger scans releases from the last 24h to catch any that had
 * consensus backfilled after the actual was recorded.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

const SCAN_WINDOW_HOURS = 24
const SURPRISE_FLOOR_Z = 1.0
const SEVERITY_CAP_Z = 3.0

interface DirectionEntry {
  positive: number
  negative: number
}

export async function macroSurpriseTrigger(ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - SCAN_WINDOW_HOURS * 60 * 60 * 1000)

  // Pull candidate releases with both actual and consensus.
  const releases = await ctx.prisma.macroRelease.findMany({
    where: {
      actualReleased: { gte: windowStart, lte: ctx.now },
      actualValue: { not: null },
      consensusValue: { not: null },
    },
    select: {
      id: true,
      indicator: true,
      releaseDate: true,
      actualValue: true,
      consensusValue: true,
      surpriseZscore: true,
      unit: true,
    },
  })

  if (releases.length === 0) return []

  // Deduplicate: skip releases where we've already fired T-GT9 for this
  // indicator + releaseDate (idempotent on repeat scans).
  const existingFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: 'T-GT9',
      firedAt: { gte: windowStart, lte: ctx.now },
    },
    select: { metadata: true },
  })
  const firedKeys = new Set(
    existingFires.map((e) => {
      const md = e.metadata as Record<string, unknown> | null
      return `${md?.indicator}|${md?.release_date}`
    }),
  )

  const fires: TriggerFireEvent[] = []

  // Load all indicator configs in one go.
  const indicators = new Set(releases.map((r) => r.indicator))
  const configs = await ctx.prisma.macroIndicatorConfig.findMany({
    where: { indicator: { in: Array.from(indicators) } },
    select: {
      indicator: true,
      historicalStddev: true,
      directionMapping: true,
      relevantAssets: true,
    },
  })
  const configByIndicator = new Map(configs.map((c) => [c.indicator, c]))

  // Build an identifier → entityId lookup for every relevantAsset across
  // all configs.
  const allRelevantIdentifiers = new Set<string>()
  for (const cfg of configs) for (const a of cfg.relevantAssets) allRelevantIdentifiers.add(a)
  const entityRows = await ctx.prisma.trackedEntity.findMany({
    where: { identifier: { in: Array.from(allRelevantIdentifiers) } },
    select: { id: true, identifier: true },
  })
  const entityIdByIdentifier = new Map(entityRows.map((e) => [e.identifier, e.id]))

  for (const release of releases) {
    const key = `${release.indicator}|${release.releaseDate.toISOString()}`
    if (firedKeys.has(key)) continue

    const config = configByIndicator.get(release.indicator)
    if (!config) continue
    if (!release.actualValue || release.consensusValue === null) continue

    const surprise = release.actualValue - release.consensusValue
    const zScore = config.historicalStddev > 0 ? surprise / config.historicalStddev : 0
    if (Math.abs(zScore) < SURPRISE_FLOOR_Z) continue

    const severity = Math.min(Math.abs(zScore) / SEVERITY_CAP_Z, 1.0)
    // Prisma types directionMapping as JsonValue; narrow via unknown.
    const directionMap = config.directionMapping as unknown as Record<string, DirectionEntry>

    for (const [identifier, dir] of Object.entries(directionMap ?? {})) {
      const entityId = entityIdByIdentifier.get(identifier)
      if (!entityId) continue
      const direction = surprise >= 0 ? dir.positive : dir.negative
      if (direction === 0) continue
      fires.push({
        entityId,
        triggerType: 'T-GT9',
        stream: 'ground_truth',
        severity: Math.min(Math.abs(direction) * severity, 1.0),
        metadata: {
          indicator: release.indicator,
          release_date: release.releaseDate.toISOString(),
          actual: release.actualValue,
          consensus: release.consensusValue,
          surprise,
          z_score: zScore,
          direction: direction > 0 ? 1 : -1,
          unit: release.unit,
        },
      })
    }
  }

  return fires
}
