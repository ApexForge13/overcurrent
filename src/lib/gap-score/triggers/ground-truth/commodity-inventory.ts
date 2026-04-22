/**
 * T-GT8 — commodity inventory release.
 *
 * Reads MacroRelease rows with both actualValue and consensusValue
 * populated (surprise z-score computed at upsert time). Fires when
 * |surpriseZscore| > 1.0 per Phase 1 addendum A1.4 T-GT8.
 *
 * Severity = |z| / 3, capped at 1.0.
 * Direction pulled from MacroIndicatorConfig.directionMapping (per
 * relevantAsset) — same mechanism as T-GT9.
 *
 * USDA indicators currently have null consensusValue (no USDA consensus
 * scraper exists yet). They're filtered out naturally by the
 * `consensusValue: { not: null }` predicate — stub state preserved.
 *
 * Scheduled every 30 min: EIA releases land Wed/Thu at 10:30 ET.
 * Dedupe on (entity × release) via TriggerEvent metadata check.
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

const TRIGGER_ID = 'T-GT8'
const SCAN_WINDOW_HOURS = 48
const SURPRISE_FLOOR_Z = 1.0
const SEVERITY_CAP_Z = 3.0

const INVENTORY_CATEGORY = 'inventory'

interface DirectionEntry {
  positive: number
  negative: number
}

export async function commodityInventoryTrigger(
  ctx: TriggerContext,
): Promise<TriggerFireEvent[]> {
  const windowStart = new Date(ctx.now.getTime() - SCAN_WINDOW_HOURS * 60 * 60 * 1000)

  // Pull candidate inventory releases: category = 'inventory' on the config.
  // Use MacroRelease directly + filter by indicator in the inventory-category
  // set to avoid coupling this trigger to the broader T-GT9 flow.
  const inventoryConfigs = await ctx.prisma.macroIndicatorConfig.findMany({
    where: { category: INVENTORY_CATEGORY },
    select: {
      indicator: true,
      historicalStddev: true,
      directionMapping: true,
      relevantAssets: true,
    },
  })
  if (inventoryConfigs.length === 0) return []

  const inventoryIndicators = inventoryConfigs.map((c) => c.indicator)
  const configByIndicator = new Map(inventoryConfigs.map((c) => [c.indicator, c]))

  const releases = await ctx.prisma.macroRelease.findMany({
    where: {
      indicator: { in: inventoryIndicators },
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

  // Dedupe: skip releases where we've already fired T-GT8 for this
  // indicator + releaseDate
  const existingFires = await ctx.prisma.triggerEvent.findMany({
    where: {
      triggerType: TRIGGER_ID,
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

  // Resolve all relevant assets across configs once
  const allRelevantIdentifiers = new Set<string>()
  for (const cfg of inventoryConfigs) for (const a of cfg.relevantAssets) allRelevantIdentifiers.add(a)
  const entityRows = await ctx.prisma.trackedEntity.findMany({
    where: { identifier: { in: Array.from(allRelevantIdentifiers) } },
    select: { id: true, identifier: true },
  })
  const entityIdByIdentifier = new Map(entityRows.map((e) => [e.identifier, e.id]))

  const fires: TriggerFireEvent[] = []

  for (const release of releases) {
    const key = `${release.indicator}|${release.releaseDate.toISOString()}`
    if (firedKeys.has(key)) continue
    if (release.actualValue === null || release.consensusValue === null) continue

    const config = configByIndicator.get(release.indicator)
    if (!config) continue
    if (!config.historicalStddev || config.historicalStddev <= 0) continue

    const surprise = release.actualValue - release.consensusValue
    const zScore = release.surpriseZscore ?? surprise / config.historicalStddev
    if (Math.abs(zScore) < SURPRISE_FLOOR_Z) continue

    const severity = Math.min(Math.abs(zScore) / SEVERITY_CAP_Z, 1.0)
    const directionMap = config.directionMapping as unknown as Record<string, DirectionEntry>

    for (const [identifier, dir] of Object.entries(directionMap ?? {})) {
      const entityId = entityIdByIdentifier.get(identifier)
      if (!entityId) continue
      const direction = surprise >= 0 ? dir.positive : dir.negative
      if (direction === 0) continue
      fires.push({
        entityId,
        triggerType: TRIGGER_ID,
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
