import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-guard'
import { prisma } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { runMergeAgent } from '@/agents/reanalysis-merge'

export const maxDuration = 300

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await params

  // ── Load original story with all related data ──
  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      sources: true,
      claims: { orderBy: { sortOrder: 'asc' } },
      discrepancies: true,
      omissions: true,
      framings: true,
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  if (story.reanalysisStatus === 'running') {
    return Response.json(
      { error: 'Re-analysis already in progress' },
      { status: 409 },
    )
  }

  // ── Mark as running ──
  await prisma.story.update({
    where: { id },
    data: { reanalysisStatus: 'running' },
  })

  // ── SSE stream for progress ──
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event, ...(data as object) })}\n\n`,
            ),
          )
        } catch {
          // controller may be closed
        }
      }

      // Keepalive pings every 10s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          clearInterval(keepalive)
        }
      }, 10_000)

      try {
        send('progress', { phase: 'pipeline', message: 'Starting V2 pipeline...' })

        // ── Run full pipeline to get fresh analysis ──
        const { runVerifyPipeline } = await import('@/lib/pipeline')
        const newStorySlug = await runVerifyPipeline(
          story.searchQuery,
          (event, data) => {
            send('progress', { phase: 'pipeline', pipelineEvent: event, ...(data as object) })
          },
        )

        send('progress', { phase: 'loading', message: 'Loading V2 results...' })

        // ── Load the new story the pipeline created (pipeline returns slug) ──
        const newStory = await prisma.story.findUnique({
          where: { slug: newStorySlug },
          include: {
            sources: true,
            claims: { orderBy: { sortOrder: 'asc' } },
            discrepancies: true,
            omissions: true,
            framings: true,
          },
        })

        if (!newStory) {
          throw new Error('Pipeline completed but new story record not found')
        }

        send('progress', { phase: 'merge', message: 'Running merge agent...' })

        // ── Build V2 synthesis shape from the new story ──
        // Parse buried evidence from confidenceNote JSON
        let buriedEvidence: Array<{ fact: string; reportedBy: string; contradicts: string }> = []
        if (newStory.confidenceNote) {
          try {
            const parsed = JSON.parse(newStory.confidenceNote)
            buriedEvidence = (parsed.buriedEvidence ?? []).map(
              (b: { fact?: string; reportedBy?: string; contradicts?: string }) => ({
                fact: String(b.fact ?? ''),
                reportedBy: String(b.reportedBy ?? ''),
                contradicts: String(b.contradicts ?? ''),
              }),
            )
          } catch {
            // ignore parse errors
          }
        }

        const v2Synthesis = {
          claims: newStory.claims.map((c) => ({
            claim: c.claim,
            confidence: c.confidence,
            supportedBy: c.supportedBy,
            contradictedBy: c.contradictedBy,
            notes: c.notes ?? undefined,
          })),
          discrepancies: newStory.discrepancies.map((d) => ({
            issue: d.issue,
            sideA: d.sideA,
            sideB: d.sideB,
            sourcesA: d.sourcesA,
            sourcesB: d.sourcesB,
            assessment: d.assessment ?? '',
          })),
          omissions: newStory.omissions.map((o) => ({
            outletRegion: o.outletRegion,
            missing: o.missing,
            presentIn: o.presentIn,
            significance: o.significance ?? '',
          })),
          buriedEvidence,
        }

        const v2Sources = newStory.sources.map((s) => ({
          url: s.url,
          title: s.title,
          outlet: s.outlet,
          outletType: s.outletType,
          country: s.country,
          region: s.region,
          language: s.language,
          politicalLean: s.politicalLean,
          reliability: s.reliability,
        }))

        // ── Run merge agent ──
        const { plan, costUsd: mergeCost } = await runMergeAgent(
          story.headline,
          story.claims.map((c) => ({
            id: c.id,
            claim: c.claim,
            confidence: c.confidence,
            supportedBy: c.supportedBy,
            contradictedBy: c.contradictedBy,
            notes: c.notes,
          })),
          story.sources.map((s) => ({
            url: s.url,
            outlet: s.outlet,
            region: s.region,
          })),
          story.discrepancies.map((d) => ({
            id: d.id,
            issue: d.issue,
            sideA: d.sideA,
            sideB: d.sideB,
            assessment: d.assessment,
          })),
          v2Synthesis,
          v2Sources,
          story.id,
        )

        send('progress', { phase: 'applying', message: 'Applying merge plan...' })

        // ── Apply merge atomically ──
        const newVersion = story.currentVersion + 1

        await prisma.$transaction(
          async (
            tx: Omit<
              PrismaClient,
              '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
            >,
          ) => {
            // 1. Increment version on original story
            await tx.story.update({
              where: { id: story.id },
              data: {
                currentVersion: newVersion,
                lastReanalyzed: new Date(),
                reanalysisStatus: 'review',
                isOngoing: true,
                // Update headline/synopsis if the new pipeline produced better data
                headline: newStory.headline || story.headline,
                synopsis: newStory.synopsis || story.synopsis,
                // Merge source/country/region counts (take max)
                sourceCount: Math.max(
                  story.sourceCount,
                  story.sourceCount + plan.newSources.length,
                ),
                countryCount: Math.max(story.countryCount, newStory.countryCount),
                regionCount: Math.max(story.regionCount, newStory.regionCount),
              },
            })

            // 2. Create StoryVersion record
            await tx.storyVersion.create({
              data: {
                storyId: story.id,
                versionNumber: newVersion,
                status: 'pending',
                newSourceCount: plan.newSources.length,
                newClaimsAdded: plan.newClaims.length,
                claimsContradicted: plan.contradictedClaims.length,
                claimsCorroborated: plan.upgradedClaims.length,
                changesSummary: plan.changesSummary,
                rawSynthesis: JSON.stringify(v2Synthesis),
                costUsd: mergeCost + (newStory.totalCost ?? 0),
              },
            })

            // 3. Insert new claims
            if (plan.newClaims.length > 0) {
              const existingClaimCount = story.claims.length
              await tx.claim.createMany({
                data: plan.newClaims.map((c, i) => ({
                  storyId: story.id,
                  claim: c.claim,
                  confidence: c.confidence,
                  supportedBy: c.supportedBy,
                  contradictedBy: '',
                  notes: c.notes || null,
                  sortOrder: existingClaimCount + i,
                  addedInVersion: newVersion,
                  status: 'active',
                })),
              })
            }

            // 4. Update contradicted V1 claims
            for (const cc of plan.contradictedClaims) {
              if (cc.originalClaimId) {
                await tx.claim.updateMany({
                  where: { id: cc.originalClaimId, storyId: story.id },
                  data: {
                    status: 'contradicted',
                    contradictionNote: cc.contradictionNote,
                    contradictedInVersion: newVersion,
                    contradictedBy: cc.contradictingEvidence,
                  },
                })
              }
            }

            // 5. Update corroborated/upgraded V1 claims
            for (const uc of plan.upgradedClaims) {
              if (uc.originalClaimId) {
                // Fetch the current claim to extend supportedBy
                const existing = await tx.claim.findUnique({
                  where: { id: uc.originalClaimId },
                })
                if (existing && existing.storyId === story.id) {
                  const extendedSupport = existing.supportedBy
                    ? `${existing.supportedBy}; ${uc.newSupportedBy}`
                    : uc.newSupportedBy
                  await tx.claim.update({
                    where: { id: uc.originalClaimId },
                    data: {
                      status: 'corroborated',
                      supportedBy: extendedSupport,
                      notes: existing.notes
                        ? `${existing.notes} | V${newVersion}: ${uc.upgradeNote}`
                        : `V${newVersion}: ${uc.upgradeNote}`,
                    },
                  })
                }
              }
            }

            // 6. Insert new sources
            if (plan.newSources.length > 0) {
              await tx.source.createMany({
                data: plan.newSources.map((s) => ({
                  storyId: story.id,
                  url: s.url,
                  title: s.title,
                  outlet: s.outlet,
                  outletType: s.outletType,
                  country: s.country,
                  region: s.region,
                  language: s.language,
                  politicalLean: s.politicalLean,
                  reliability: s.reliability,
                  addedInVersion: newVersion,
                })),
              })
            }

            // 7. Insert new discrepancies
            if (plan.newDiscrepancies.length > 0) {
              await tx.discrepancy.createMany({
                data: plan.newDiscrepancies.map((d) => ({
                  storyId: story.id,
                  issue: d.issue,
                  sideA: d.sideA,
                  sideB: d.sideB,
                  sourcesA: d.sourcesA,
                  sourcesB: d.sourcesB,
                  assessment: d.assessment || null,
                  addedInVersion: newVersion,
                  status: 'active',
                })),
              })
            }

            // 8. Resolve discrepancies that V2 evidence settles
            for (const rd of plan.resolvedDiscrepancies) {
              if (rd.originalId) {
                await tx.discrepancy.updateMany({
                  where: { id: rd.originalId, storyId: story.id },
                  data: {
                    status: 'resolved',
                    assessment: rd.resolutionNote,
                  },
                })
              }
            }

            // 9. Insert new omissions
            if (plan.newOmissions.length > 0) {
              await tx.omission.createMany({
                data: plan.newOmissions.map((o) => ({
                  storyId: story.id,
                  outletRegion: o.outletRegion,
                  missing: o.missing,
                  presentIn: o.presentIn,
                  significance: o.significance || null,
                  addedInVersion: newVersion,
                  status: 'active',
                })),
              })
            }

            // 10. Delete the temporary new story (cascade deletes its sources, claims, etc.)
            await tx.story.delete({ where: { id: newStory.id } })
          },
          { timeout: 30000 },
        )

        send('complete', {
          phase: 'done',
          versionNumber: newVersion,
          changes: plan.changesSummary,
          stats: {
            newClaims: plan.newClaims.length,
            upgradedClaims: plan.upgradedClaims.length,
            contradictedClaims: plan.contradictedClaims.length,
            newSources: plan.newSources.length,
            newDiscrepancies: plan.newDiscrepancies.length,
            resolvedDiscrepancies: plan.resolvedDiscrepancies.length,
            newOmissions: plan.newOmissions.length,
          },
        })
      } catch (error) {
        console.error('[reanalyze] Error:', error)

        // Reset status on failure
        await prisma.story
          .update({
            where: { id },
            data: { reanalysisStatus: null },
          })
          .catch(() => {
            // ignore if story was already cleaned up
          })

        send('error', {
          phase: 'error',
          message:
            error instanceof Error ? error.message : 'Unknown error during re-analysis',
        })
      } finally {
        clearInterval(keepalive)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ── PUT: approve or reject a pending re-analysis version ──────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  const body = (await request.json()) as { action?: 'approve' | 'reject'; versionId?: string }
  const action = body.action
  const versionId = body.versionId

  if (!action || (action !== 'approve' && action !== 'reject')) {
    return Response.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
  }
  if (!versionId) {
    return Response.json({ error: 'versionId required' }, { status: 400 })
  }

  const story = await prisma.story.findUnique({ where: { id } })
  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  const version = await prisma.storyVersion.findUnique({ where: { id: versionId } })
  if (!version || version.storyId !== id) {
    return Response.json({ error: 'Version not found' }, { status: 404 })
  }
  if (version.status !== 'pending') {
    return Response.json(
      { error: `Version is already ${version.status}` },
      { status: 409 },
    )
  }

  if (action === 'approve') {
    // Mark version approved, set story reanalysisStatus back to null (live)
    await prisma.$transaction(
      async (
        tx: Omit<
          PrismaClient,
          '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
        >,
      ) => {
        await tx.storyVersion.update({
          where: { id: versionId },
          data: { status: 'approved' },
        })
        await tx.story.update({
          where: { id },
          data: { reanalysisStatus: null },
        })
      },
    )
    return Response.json({ success: true, versionNumber: version.versionNumber })
  }

  // Reject: roll back all V_N changes — delete new rows, unflag contradicted, revert corroborated
  const versionNumber = version.versionNumber

  await prisma.$transaction(
    async (
      tx: Omit<
        PrismaClient,
        '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
      >,
    ) => {
      // Delete rows added in this version
      await tx.claim.deleteMany({ where: { storyId: id, addedInVersion: versionNumber } })
      await tx.source.deleteMany({ where: { storyId: id, addedInVersion: versionNumber } })
      await tx.discrepancy.deleteMany({ where: { storyId: id, addedInVersion: versionNumber } })
      await tx.omission.deleteMany({ where: { storyId: id, addedInVersion: versionNumber } })

      // Un-contradict any claims that were flagged in this version
      await tx.claim.updateMany({
        where: { storyId: id, contradictedInVersion: versionNumber },
        data: {
          status: 'active',
          contradictionNote: null,
          contradictedInVersion: null,
          contradictedBy: '',
        },
      })

      // Revert corroborated claims — we can't perfectly restore old supportedBy/notes,
      // but downgrading status back to 'active' is enough for UI purposes.
      // (V1 claims that were corroborated in V_N keep their text since it was not overwritten.)
      await tx.claim.updateMany({
        where: { storyId: id, status: 'corroborated' },
        data: { status: 'active' },
      })

      // Mark version rejected, decrement currentVersion, clear reanalysisStatus
      await tx.storyVersion.update({
        where: { id: versionId },
        data: { status: 'rejected' },
      })
      await tx.story.update({
        where: { id },
        data: {
          reanalysisStatus: null,
          currentVersion: Math.max(1, versionNumber - 1),
        },
      })
    },
    { timeout: 30000 },
  )

  return Response.json({ success: true, versionNumber, rolled_back: true })
}
