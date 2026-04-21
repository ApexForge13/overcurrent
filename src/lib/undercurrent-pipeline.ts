import { prisma } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { slugify } from '@/lib/utils'
import { searchGdelt } from '@/ingestion/gdelt'
import { getTopicVolume, getTopThemes } from '@/ingestion/gdelt-volume'
import { getCongressionalActions } from '@/ingestion/congress'
import { getFederalRegisterActions } from '@/ingestion/federal-register'
import { scanForDisplacement } from '@/agents/displacement-scanner'
import { scanForQuietActions } from '@/agents/quiet-action-scanner'
import { synthesizeUndercurrent } from '@/agents/undercurrent-synthesis'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runUndercurrentPipeline(
  query: string,
  startDate?: string,
  endDate?: string,
  onProgress?: (event: string, data: unknown) => void,
): Promise<string> {
  const send = onProgress ?? (() => {})

  // ── Feature-flag gate (v2 pivot) ──
  // The undercurrent (discourse/propagation) pipeline is legacy product
  // surface. Gated here at the single orchestrator entry point so every
  // invocation path — Next.js /api/undercurrent, pipeline-service/server.ts
  // /undercurrent, test harnesses — refuses work uniformly.
  const { featureFlags } = await import('@/lib/feature-flags')
  if (!featureFlags.DISCOURSE_LAYER_ENABLED) {
    const message =
      'Undercurrent/discourse pipeline is disabled (FEATURE_DISCOURSE !== "true"). This surface is archived for the v2 pivot to Gap Score.'
    send('error', { phase: 'disabled', message })
    throw new Error(message)
  }

  const startTime = Date.now()
  let totalCost = 0

  const dates = startDate && endDate
    ? { startDate, endDate }
    : defaultDateRange()

  // ── PHASE 1: IDENTIFY DOMINANT STORY ─────────────────────────────────

  const [gdeltResults, volumeData] = await Promise.all([
    searchGdelt(query),
    getTopicVolume(query),
  ])

  // Find peak date from volume data
  let peakDate = dates.endDate
  let peakVolume = 0
  for (const point of volumeData) {
    if (point.volume > peakVolume) {
      peakVolume = point.volume
      peakDate = point.date
    }
  }

  // Count unique outlets
  const outlets = new Set(gdeltResults.map((r) => r.domain))

  // Estimate days of dominance (days with volume above 50% of peak)
  const threshold = peakVolume * 0.5
  const daysOfDominance = volumeData.filter((p) => p.volume >= threshold).length

  const dominantStory = {
    headline: gdeltResults[0]?.title ?? query,
    description: query,
    articleCount: gdeltResults.length,
    outletCount: outlets.size,
    peakDate,
    daysOfDominance: Math.max(daysOfDominance, 1),
  }

  send('identify', {
    phase: 'identify',
    message: 'Identified dominant story',
    articleCount: gdeltResults.length,
  })

  // ── PHASE 2 & 3: DISPLACEMENT + QUIET ACTIONS (parallel) ────────────

  const [displacementResult, quietActionResult] = await Promise.all([
    // PHASE 2: SCAN FOR DISPLACED STORIES
    (async () => {
      const themes = await getTopThemes(dates.startDate, dates.endDate)

      // Filter out themes that match the dominant story query
      const queryLower = query.toLowerCase()
      const otherThemes = themes
        .filter((t) => !t.theme.toLowerCase().includes(queryLower))
        .slice(0, 15)

      // Get volume data for each alternative theme
      const otherTopics = await Promise.all(
        otherThemes.map(async (t) => ({
          theme: t.theme,
          volumeData: await getTopicVolume(t.theme, '14d'),
        })),
      )

      const result = await scanForDisplacement(
        {
          headline: dominantStory.headline,
          description: dominantStory.description,
          peakDate: dominantStory.peakDate,
        },
        otherTopics,
      )
      totalCost += result.costUsd

      send('displacement', {
        phase: 'displacement',
        message: `Found ${result.displacedStories.length} displaced stories`,
      })

      return result
    })(),

    // PHASE 3: SCAN FOR QUIET ACTIONS
    (async () => {
      const [congressActions, fedRegActions] = await Promise.all([
        getCongressionalActions(dates.startDate, dates.endDate),
        getFederalRegisterActions(dates.startDate, dates.endDate),
      ])

      // For each action, measure its media coverage via GDELT
      const allActions = [
        ...congressActions.map((a) => ({ title: a.title, type: 'congress' as const })),
        ...fedRegActions.map((a) => ({ title: a.title, type: 'federal_register' as const })),
      ]

      const mediaCoverageCounts = await Promise.all(
        allActions.map(async (action) => {
          const results = await searchGdelt(action.title)
          return {
            title: action.title,
            articleCount: results.length,
          }
        }),
      )

      const result = await scanForQuietActions(
        {
          headline: dominantStory.headline,
          peakDates: `${dates.startDate} to ${dates.endDate}`,
        },
        congressActions,
        fedRegActions,
        mediaCoverageCounts,
      )
      totalCost += result.costUsd

      send('quiet_actions', {
        phase: 'quiet_actions',
        message: `Found ${result.quietActions.length} quiet actions`,
      })

      return result
    })(),
  ])

  // ── PHASE 4: SYNTHESIZE ──────────────────────────────────────────────

  send('synthesis', {
    phase: 'synthesis',
    message: 'Generating undercurrent report',
  })

  // Build timing anomalies from displaced stories with notable timing
  const timingAnomalies = displacementResult.displacedStories
    .filter((s) => s.displacementLevel === 'HIGH')
    .map((s) => ({
      event: s.headline,
      timing: s.dropoffDate,
      pattern: `Coverage dropped ${s.coverageDropPct}% during dominant story peak`,
      significance: s.significance,
    }))

  const synthesisResult = await synthesizeUndercurrent(
    dominantStory,
    displacementResult.displacedStories,
    quietActionResult.quietActions,
    timingAnomalies,
  )
  totalCost += synthesisResult.costUsd

  // ── PHASE 5: SAVE TO DATABASE ────────────────────────────────────────

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
  const slug = slugify(synthesisResult.headline || query).slice(0, 80)

  // Ensure slug uniqueness
  let uniqueSlug = slug
  const existing = await prisma.undercurrentReport.findUnique({ where: { slug } })
  if (existing) {
    uniqueSlug = `${slug}-${Date.now().toString(36)}`
  }

  const report = await prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
    const report = await tx.undercurrentReport.create({
      data: {
        slug: uniqueSlug,
        dominantHeadline: dominantStory.headline,
        dominantDescription: dominantStory.description,
        dateRangeStart: new Date(dates.startDate),
        dateRangeEnd: new Date(dates.endDate),
        searchQuery: query,
        synopsis: synthesisResult.synopsis,
        totalCost,
        analysisSeconds: elapsedSeconds,
      },
    })

    // Displaced stories
    if (displacementResult.displacedStories.length > 0) {
      await tx.displacedStory.createMany({
        data: displacementResult.displacedStories.map((s, i) => ({
          reportId: report.id,
          headline: s.headline,
          peakCoverage: s.peakCoverage,
          dropoffDate: s.dropoffDate,
          currentCoverage: s.currentStatus,
          coverageDropPct: s.coverageDropPct,
          wasResolved: s.wasResolved,
          resolutionNote: s.resolutionNote ?? null,
          significance: s.significance,
          sampleSources: JSON.stringify(s.sampleSources),
          sortOrder: i,
        })),
      })
    }

    // Quiet actions
    if (quietActionResult.quietActions.length > 0) {
      await tx.quietAction.createMany({
        data: quietActionResult.quietActions.map((a, i) => ({
          reportId: report.id,
          actionType: a.actionType,
          title: a.title,
          description: a.description,
          date: a.date,
          source: a.sourceUrl,
          mediaCoverage: a.mediaCoverage,
          significance: a.significance,
          sortOrder: i,
        })),
      })
    }

    // Timing anomalies
    if (timingAnomalies.length > 0) {
      await tx.timingAnomaly.createMany({
        data: timingAnomalies.map((t, i) => ({
          reportId: report.id,
          event: t.event,
          timing: t.timing,
          pattern: t.pattern,
          significance: t.significance,
          sortOrder: i,
        })),
      })
    }

    return report
  })

  send('complete', {
    phase: 'complete',
    slug: report.slug,
    reportId: report.id,
  })

  return report.slug
}
