/**
 * Registers all raw-signal integrations with the runner.
 * Import this module anywhere in the app before calling processClusterQueue
 * to ensure every available integration is registered.
 *
 * New integrations: add your runner and registerIntegration call below.
 */

import { registerIntegration } from '../runner'
import { gdeltRunner } from './gdelt'
import { sentinelOpticalRunner, sentinelRadarRunner } from './sentinel-hub'

// Registered at module-load time. Safe to import multiple times.
registerIntegration('gdelt', gdeltRunner)
registerIntegration('satellite_optical', sentinelOpticalRunner)
registerIntegration('satellite_radar', sentinelRadarRunner)

// ── Future integrations register here ────────────────────────────────
// registerIntegration('government_spending', usaspendingRunner)
// registerIntegration('sec_filing', secEdgarRunner)
// registerIntegration('sanctions_ofac', ofacRunner)
// registerIntegration('aviation_adsb', adsbRunner)
// registerIntegration('maritime_ais', marineTrafficRunner)
// registerIntegration('legal_courtlistener', courtListenerRunner)
// registerIntegration('legal_pacer', pacerRunner)            // GATED BY APPROVAL
// registerIntegration('satellite_fire', nasaFirmsRunner)
// registerIntegration('copernicus_emergency', cemsRunner)
// registerIntegration('satellite_crowdsourced', openAerialMapRunner)
// registerIntegration('maritime_fishing', gfwRunner)
// registerIntegration('nasa_earthdata', nasaEarthdataRunner)
// registerIntegration('world_bank', worldBankRunner)
// registerIntegration('un_comtrade', comtradeRunner)
// registerIntegration('fred_macro', fredRunner)
// registerIntegration('epa_enforcement', epaRunner)
// registerIntegration('financial_equity', polygonEquityRunner)
// registerIntegration('financial_options', polygonOptionsRunner)
// registerIntegration('financial_commodity', polygonCommodityRunner)
// registerIntegration('financial_crypto', cryptoRunner)

export { processClusterQueue, processQueueEntry } from '../runner'
