/**
 * Create the CaseStudyEntry for the $760M Brent futures selloff finding.
 *
 * Source: Insight (Korea), https://www.insight.co.kr/news/550718, 2026-04-19
 * Story:  cmo5gj5p6003o11pl7mpl0fs1 (Hormuz cluster v2 consolidation, status=review)
 * Cluster: cmo5efugm00c312pikkw7jsl4
 * Umbrella: cmo3f21ak000004l11k0vw7if
 *
 * Idempotent: checks for an existing entry with the same headline before inserting.
 *
 * Run once: npx tsx scripts/create-760m-case-study.ts
 */

import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { prisma } from '../src/lib/db'

dotenvConfig({ override: true })

const CLUSTER_ID = 'cmo5efugm00c312pikkw7jsl4'
const UMBRELLA_ID = 'cmo3f21ak000004l11k0vw7if'

const HEADLINE =
  'Insight (Korea) catches $760M Brent futures selloff 20 minutes before Iran\'s Hormuz reopening — CFTC opens investigation, English-language press absent'

const FULL_DESCRIPTION = `## The Finding

At 12:24 PM on April 18, 2026 — 20 minutes before Iran publicly announced reopening the Strait of Hormuz — a single-minute selloff of 7,990 Brent crude futures contracts (~$760M notional, ~1 trillion KRW) hit CME and ICE exchanges. The US Commodity Futures Trading Commission (CFTC) opened an investigation, requesting data from both exchanges. The pattern is consistent with informed trading on advance knowledge of the diplomatic announcement.

## The Source

The finding was reported by **Insight (인사이트)**, a Korean-language financial-news outlet, citing LSEG (Refinitiv) data and CFTC institutional sources via Reuters. Article URL: https://www.insight.co.kr/news/550718, published 2026-04-19 06:45 UTC.

The Korean headline ("호르무즈 개방 발표 20분 전 1조원 베팅") translates roughly as: "1-trillion-won bet 20 minutes before Hormuz reopening announcement — another info-leak suspicion."

## What 250+ English-Language Outlets Missed

Across the 282 sources Overcurrent ingested for the Hormuz consolidation analysis on April 19, the $760M selloff appeared in **exactly one outlet** — Insight. It did not appear in:

- **Wire services:** AP, Reuters, Bloomberg
- **Financial press:** Financial Times, Wall Street Journal, Bloomberg
- **General news (English):** The Guardian, Al Jazeera, Gulf News, BBC, Washington Post, New York Times
- **Specialist maritime / oil press:** Lloyd's List, S&P Global, Argus Media, Insurance Journal

Overcurrent's fact-survival tracker logs the finding as: originLayer = on_scene (Korean financial press), survivedTo = national, diedAt = international. The single point at which the fact failed to propagate was the Korean → English-language handoff.

## Why This Reframes the Story

The dominant narrative across the 282 sources framed Iran's reopening announcement as a **surprise diplomatic development** — a positive shift that briefly cooled oil prices before Iran reversed course 24 hours later.

The $760M futures selloff, if verified by the CFTC investigation, fundamentally changes that framing: someone took a 7,990-contract position 20 minutes before the announcement. That is not consistent with surprise. It is consistent with **foreknowledge** — either institutional intelligence about Iranian intent, a leak from one of the diplomatic channels (US, Iran, Pakistan, Saudi, Turkish), or coordinated trading on advance signal.

The CFTC investigation makes the finding regulator-actionable. The investigation request to CME and ICE means traders in the contract pool will be subpoenaed.

A reader of any English-language coverage of the Hormuz crisis on April 18-19 would have no idea this happened.

## Enterprise Implication

A trading desk reading the dominant English-language coverage on April 18 would have priced the Hormuz reopening as a surprise diplomatic positive and faded the oil-price recovery accordingly. A trading desk with Overcurrent — surfacing the Insight finding within hours of publication — would have known that the move was telegraphed to at least one counterparty large enough to put $760M on a single-minute Brent position with apparent advance knowledge.

The structural finding is not just "Western financial press missed a single Korean source." It is that a CFTC-actionable market-manipulation signal sat in Korean-language media for at least 24 hours without any English-language pickup, including from the financial press whose readers would most directly act on it. Overcurrent's monitoring detected the divergence in the same news cycle as the original Insight publication.`

async function main() {
  console.log('\n━━━ CREATE $760M case study ━━━\n')

  // Idempotent check
  const existing = await prisma.caseStudyEntry.findFirst({
    where: { headline: HEADLINE },
    select: { id: true, createdAt: true },
  })
  if (existing) {
    console.log(`✗ Already exists: ${existing.id} (${existing.createdAt.toISOString()})`)
    console.log('  Skipping insert. Delete the existing row first if you want to re-create.')
    return
  }

  const entry = await prisma.caseStudyEntry.create({
    data: {
      rawSignalLayerId: null,
      storyClusterId: CLUSTER_ID,
      umbrellaArcId: UMBRELLA_ID,
      signalType: 'predictive_finding_silenced', // new value, no migration needed (String column)
      headline: HEADLINE,
      fullDescription: FULL_DESCRIPTION,
      storyPhaseAtDetection: 'consolidation',
      divergenceType: 'narrative_omits_raw',
      isPublishable: false, // admin toggles to true after legal/factual review
    },
  })

  console.log(`✓ CaseStudyEntry created`)
  console.log(`  id:                    ${entry.id}`)
  console.log(`  signalType:            ${entry.signalType}`)
  console.log(`  divergenceType:        ${entry.divergenceType}`)
  console.log(`  storyPhase:            ${entry.storyPhaseAtDetection}`)
  console.log(`  isPublishable:         ${entry.isPublishable}`)
  console.log(`  storyClusterId:        ${entry.storyClusterId}`)
  console.log(`  umbrellaArcId:         ${entry.umbrellaArcId}`)
  console.log(`  fullDescription chars: ${entry.fullDescription.length}`)
  console.log()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
