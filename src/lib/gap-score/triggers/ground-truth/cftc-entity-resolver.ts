/**
 * Map CFTC market codes to our TrackedEntity identifiers.
 *
 * CFTC uses its own short codes (e.g., "067651" for WTI crude on NYMEX)
 * with human-readable market names. Hand-curated mapping to our
 * identifier scheme (CL=F for WTI). Covers the big-9 commodity futures.
 *
 * Expansion policy: add aggressively when a CFTC fire references an
 * unmapped market. Current scope: energy (crude, nat gas, gasoline),
 * metals (gold, silver, copper), grains (corn, wheat, soybeans).
 */

export interface CftcMarketMapping {
  /** CFTC's cftc_contract_market_code — the stable 6-digit numeric code. */
  cftcCode: string
  /** Our TrackedEntity.identifier. */
  trackedEntityIdentifier: string
  /** Human-readable market name (for metadata; not used for matching). */
  label: string
}

export const CFTC_MARKET_MAP: readonly CftcMarketMapping[] = Object.freeze([
  // Energy
  { cftcCode: '067651', trackedEntityIdentifier: 'CL=F', label: 'Crude Oil, Light Sweet (NYMEX)' },
  { cftcCode: '06765T', trackedEntityIdentifier: 'BZ=F', label: 'Brent Crude (ICE)' },
  { cftcCode: '023391', trackedEntityIdentifier: 'NG=F', label: 'Natural Gas, Henry Hub (NYMEX)' },
  { cftcCode: '111659', trackedEntityIdentifier: 'RB=F', label: 'RBOB Gasoline (NYMEX)' },
  { cftcCode: '022651', trackedEntityIdentifier: 'HO=F', label: 'Heating Oil No. 2 (NYMEX)' },
  // Metals
  { cftcCode: '088691', trackedEntityIdentifier: 'GC=F', label: 'Gold (COMEX)' },
  { cftcCode: '084691', trackedEntityIdentifier: 'SI=F', label: 'Silver (COMEX)' },
  { cftcCode: '085692', trackedEntityIdentifier: 'HG=F', label: 'Copper (COMEX)' },
  // Grains
  { cftcCode: '002602', trackedEntityIdentifier: 'ZC=F', label: 'Corn (CBOT)' },
  { cftcCode: '001602', trackedEntityIdentifier: 'ZW=F', label: 'Wheat (CBOT)' },
  { cftcCode: '005602', trackedEntityIdentifier: 'ZS=F', label: 'Soybeans (CBOT)' },
])

const BY_CODE = new Map(CFTC_MARKET_MAP.map((m) => [m.cftcCode, m]))

export function resolveCftcCode(cftcCode: string): CftcMarketMapping | null {
  return BY_CODE.get(cftcCode) ?? null
}
