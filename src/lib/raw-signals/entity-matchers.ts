/**
 * Entity matchers for Layer 2 trigger logic.
 *
 * Takes the cluster's extracted entities (from StoryCluster.clusterKeywords JSON)
 * and determines which signal types to queue based on entity identity.
 *
 * Async matchers that require I/O (OFAC SDN list, Copernicus activation list)
 * live in their integration modules and are called from the Layer 2 driver
 * in queueRawSignalEnrichment — this file only does lightweight synchronous
 * matching.
 */

import { MARITIME_CHOKEPOINTS } from './types'
import type { SignalType } from './types'

export interface EntityMatchResult {
  signalType: SignalType
  matchedEntity: string
  reason: string
}

// ── Ticker / company-name matcher (synchronous, best-effort) ──────────
// Checks whether any entity looks like a publicly-traded company or a
// stock ticker. This is intentionally conservative — false positives flow
// to SEC/financial integrations which gracefully report "no match" when
// the entity isn't actually a real ticker.
//
// Pattern 1: uppercase token of 1–5 chars (e.g. "AAPL", "GM", "F")
// Pattern 2: token with common corporate suffixes
//            (Inc, Corp, Ltd, PLC, AG, SA, NV, LLC, Holdings, Group)
const TICKER_PATTERN = /^[A-Z]{1,5}$/
const CORPORATE_SUFFIX_PATTERN =
  /\b(Inc|Corp|Corporation|Ltd|Limited|PLC|AG|SA|NV|LLC|LLP|Holdings|Group|Company|Co)\b\.?$/i

export function matchCompaniesAndTickers(entities: string[]): EntityMatchResult[] {
  const matches: EntityMatchResult[] = []
  const seen = new Set<string>()

  for (const entity of entities) {
    const trimmed = entity.trim()
    if (!trimmed) continue

    let matched = false
    let reason = ''

    if (TICKER_PATTERN.test(trimmed)) {
      matched = true
      reason = `entity "${trimmed}" matches ticker pattern`
    } else if (CORPORATE_SUFFIX_PATTERN.test(trimmed)) {
      matched = true
      reason = `entity "${trimmed}" has corporate suffix`
    }

    if (matched) {
      // Dedupe by signalType — one trigger per source type per cluster
      if (!seen.has('financial_equity')) {
        matches.push({ signalType: 'financial_equity', matchedEntity: trimmed, reason })
        seen.add('financial_equity')
      }
      if (!seen.has('sec_filing')) {
        matches.push({ signalType: 'sec_filing', matchedEntity: trimmed, reason })
        seen.add('sec_filing')
      }
    }
  }

  return matches
}

// ── Maritime chokepoint matcher ───────────────────────────────────────
export function matchMaritimeChokepoints(entities: string[]): EntityMatchResult[] {
  const matches: EntityMatchResult[] = []
  const fullText = entities.join(' ').toLowerCase()

  for (const chokepoint of MARITIME_CHOKEPOINTS) {
    if (fullText.includes(chokepoint.toLowerCase())) {
      return [
        {
          signalType: 'maritime_ais',
          matchedEntity: chokepoint,
          reason: `cluster references maritime chokepoint "${chokepoint}"`,
        },
      ]
    }
  }

  return matches
}

// ── Vessel-name matcher (heuristic) ───────────────────────────────────
// Fuzzy match for "MV <Name>", "USS <Name>", "MSC <Name>", tanker names, etc.
// When in doubt, let it through — maritime AIS query returns empty cheaply.
const VESSEL_PREFIX_PATTERN = /\b(MV|M\/V|USS|HMS|RV|MSC|MSC|Ever|CMA CGM)\s+\w+/i

export function matchVesselNames(entities: string[]): EntityMatchResult[] {
  for (const entity of entities) {
    if (VESSEL_PREFIX_PATTERN.test(entity)) {
      return [
        {
          signalType: 'maritime_ais',
          matchedEntity: entity,
          reason: `entity "${entity}" looks like a vessel name`,
        },
      ]
    }
  }
  return []
}
