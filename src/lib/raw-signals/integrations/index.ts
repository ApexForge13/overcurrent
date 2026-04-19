/**
 * Registers all raw-signal integrations with the runner.
 * Import this module anywhere in the app before calling processClusterQueue
 * to ensure every available integration is registered.
 *
 * Phase 6 added 30+ free-tier runners. Phase 7 will add credentialed-free
 * runners (Sentinel Hub is already wired, more coming). Phase 8 wires paid
 * Polygon integrations. Phase 9 adds the social-layer runners.
 *
 * Integrations that return null (stubs awaiting Phase 10 backfill or
 * Phase 9 social wiring) leave their queue entries in 'skipped' status
 * with the stub-log line in console — no fabricated data ever written.
 */

import { registerIntegration } from '../runner'

// ─── Session 4 Phase 6: free credentialless / free-tier runners ────────
import { gdeltRunner } from './gdelt'
import { sentinelOpticalRunner, sentinelRadarRunner } from './sentinel-hub'
import { courtListenerRunner } from './courtlistener'
import { ofacRunner } from './ofac'
import { nasaFirmsRunner } from './nasa-firms'

// Government + policy
import { usaSpendingRunner } from './usaspending'
import { secEdgarRunner } from './sec-edgar'
import { federalRegisterRunner } from './federal-register'
import { travelAdvisoryUsRunner } from './travel-advisory-us'
import { travelAdvisoryUkRunner } from './travel-advisory-uk'
import { unSecurityCouncilRunner } from './un-security-council'

// Sanctions + ownership
import { icijOffshoreRunner } from './icij-offshore'
import { openCorporatesRunner } from './open-corporates'
import { openOwnershipRunner } from './open-ownership'

// Macroeconomic + environment
import { worldBankRunner } from './world-bank'
import { unComtradeRunner } from './un-comtrade'
import { fredMacroRunner } from './fred-macro'
import { epaEnforcementRunner } from './epa-enforcement'
import { armsSipriRunner } from './arms-sipri'

// Energy + infrastructure + environment
import { eiaEnergyRunner } from './energy-eia'
import { entsoEnergyRunner } from './energy-entso'
import { seismicUsgsRunner } from './seismic-usgs'
import { noaaWeatherRunner } from './noaa-weather'
import { cloudflareRadarRunner } from './internet-cloudflare'
import { netBlocksRunner } from './internet-netblocks'
import { iodaRunner } from './internet-ioda'

// Food / health / displacement
import { fewsNetRunner } from './food-fews'
import { faoFoodPriceRunner } from './food-fao'
import { whoDiseaseRunner } from './disease-who'
import { promedRunner } from './disease-promed'
import { unhcrRunner } from './unhcr-displacement'

// Aerospace + maritime
import { adsbExchangeRunner } from './adsb-exchange'
import { openAerialMapRunner } from './openaerialmap'
import { portStateControlRunner } from './port-state-control'
import { shippingRatesRunner } from './shipping-rates'

// Phase 7 — credentialed tier (mixed free + paid)
import { datadockedRunner } from './datadocked'
import { globalFishingWatchRunner } from './global-fishing-watch'
import { spaceTrackRunner } from './space-track'
import { nasaEarthdataRunner } from './nasa-earthdata'
// aishub.ts remains as a free-tier dormant option (not imported, not
// registered). marinetraffic.ts is the enterprise-tier dormant scaffold
// (MarineTraffic / Kpler). vesselfinder.ts has been removed — replaced by
// Datalastic. Priority order when promoting a fallback:
//   Datalastic (primary, paid ~$87/mo — registered) →
//   AIS Hub (free, dormant) →
//   MarineTraffic / Kpler (enterprise tier, dormant).
// opensky.ts is a helper imported by adsb-exchange.ts as fallback.

// Remaining
import { copernicusEmergencyRunner } from './copernicus-emergency'
import { coinGeckoRunner } from './coingecko-crypto'

// ── Existing (pre-Phase-6) ────────────────────────────────────────────
registerIntegration('gdelt', gdeltRunner)
registerIntegration('satellite_optical', sentinelOpticalRunner)
registerIntegration('satellite_radar', sentinelRadarRunner)
registerIntegration('legal_courtlistener', courtListenerRunner)
registerIntegration('sanctions_ofac', ofacRunner)
registerIntegration('satellite_fire', nasaFirmsRunner)

// ── Phase 6 — government + policy ─────────────────────────────────────
registerIntegration('government_spending', usaSpendingRunner)
registerIntegration('sec_filing', secEdgarRunner)
registerIntegration('federal_register', federalRegisterRunner)
registerIntegration('travel_advisory_us', travelAdvisoryUsRunner)
registerIntegration('travel_advisory_uk', travelAdvisoryUkRunner)
registerIntegration('un_security_council', unSecurityCouncilRunner)

// ── Phase 6 — sanctions + ownership ───────────────────────────────────
registerIntegration('icij_offshore', icijOffshoreRunner)
registerIntegration('open_corporates', openCorporatesRunner)
registerIntegration('open_ownership', openOwnershipRunner)

// ── Phase 6 — macroeconomic + environment ─────────────────────────────
registerIntegration('world_bank', worldBankRunner)
registerIntegration('un_comtrade', unComtradeRunner)
registerIntegration('fred_macro', fredMacroRunner)
registerIntegration('epa_enforcement', epaEnforcementRunner)
registerIntegration('arms_transfer_sipri', armsSipriRunner)

// ── Phase 6 — energy + infrastructure + environment ───────────────────
registerIntegration('energy_eia', eiaEnergyRunner)
registerIntegration('energy_entso', entsoEnergyRunner)
registerIntegration('seismic_usgs', seismicUsgsRunner)
registerIntegration('weather_noaa', noaaWeatherRunner)
registerIntegration('internet_cloudflare', cloudflareRadarRunner)
registerIntegration('internet_netblocks', netBlocksRunner)
registerIntegration('internet_ioda', iodaRunner)

// ── Phase 6 — food/health/displacement ────────────────────────────────
registerIntegration('food_fews', fewsNetRunner)
registerIntegration('food_fao', faoFoodPriceRunner)
registerIntegration('disease_who', whoDiseaseRunner)
registerIntegration('disease_promed', promedRunner)
registerIntegration('displacement_unhcr', unhcrRunner)

// ── Phase 6 — aerospace + maritime ────────────────────────────────────
registerIntegration('aviation_adsb', adsbExchangeRunner)
registerIntegration('satellite_crowdsourced', openAerialMapRunner)
registerIntegration('port_state_control', portStateControlRunner)
registerIntegration('shipping_rates', shippingRatesRunner)

// ── Phase 6 — remaining ───────────────────────────────────────────────
registerIntegration('copernicus_emergency', copernicusEmergencyRunner)
registerIntegration('financial_crypto', coinGeckoRunner)

// ── Phase 7 — credentialed tier (mixed free + paid) ────────────────────
registerIntegration('maritime_ais', datadockedRunner)           // Datalastic / Data Docked primary (~$87/mo paid tier; AIS Hub + VesselFinder + MarineTraffic/Kpler all dormant)
registerIntegration('maritime_fishing', globalFishingWatchRunner)
registerIntegration('space_track', spaceTrackRunner)
registerIntegration('nasa_earthdata', nasaEarthdataRunner)
// aviation_adsb is still served by adsbExchangeRunner (registered above),
// now with opensky.ts as its fallback helper — no separate registration.

// ── Future (Phase 8+) — register here as they land ────────────────────
// registerIntegration('legal_pacer', pacerRunner)                 // Phase 8 (GATED)
// registerIntegration('financial_equity', polygonEquityRunner)    // Phase 8
// registerIntegration('financial_options', polygonOptionsRunner)  // Phase 8
// registerIntegration('financial_commodity', polygonCommodityRunner) // Phase 8
// registerIntegration('earnings_transcripts', earningsRunner)     // Phase 8
// registerIntegration('social_twitter', twitterRunner)            // Phase 9
// registerIntegration('social_telegram', telegramRunner)          // Phase 9
// registerIntegration('social_reddit', redditRunner)              // Phase 9
// registerIntegration('social_linkedin', linkedInRunner)          // Phase 9
// registerIntegration('social_wechat', weChatRunner)              // Phase 9 (deferred — needs Chinese API)

export { processClusterQueue, processQueueEntry } from '../runner'
