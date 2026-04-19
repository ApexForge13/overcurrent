/**
 * Raw Signal Layer — shared types and constants.
 *
 * ADMIN-ONLY. Never surface on public-facing pages. All references to these
 * tables must be guarded by requireAdmin() at the API layer.
 *
 * The full signal-type union covers every integration called for by the
 * master build spec (Phase 6-9). Having the types in the union here (Phase 5)
 * means the 3-layer trigger logic can populate RawSignalQueue with every
 * relevant signalType even before the corresponding integration runner
 * exists — the runner simply marks "no runner registered" and skips until
 * its Phase lands.
 */

// ── Signal types ──────────────────────────────────────────────────────
// Must match RawSignalLayer.signalType string values at runtime.
export const SIGNAL_TYPES = [
  // News & events ────────────────────────────────────────────────────
  'gdelt',

  // Satellite & remote sensing ───────────────────────────────────────
  'satellite_optical',
  'satellite_radar',
  'satellite_fire',
  'satellite_crowdsourced',
  'copernicus_emergency',
  'nasa_earthdata',

  // Aviation & space ─────────────────────────────────────────────────
  'aviation_adsb',
  'space_track',

  // Maritime ─────────────────────────────────────────────────────────
  'maritime_ais',
  'maritime_fishing',
  'port_state_control',
  'shipping_rates',

  // Financial markets ────────────────────────────────────────────────
  'financial_equity',
  'financial_options',
  'financial_commodity',
  'financial_crypto',

  // Government & policy ──────────────────────────────────────────────
  'government_spending',
  'sec_filing',
  'federal_register',
  'travel_advisory_us',
  'travel_advisory_uk',
  'un_security_council',
  'un_comtrade',
  'arms_transfer_sipri',

  // Legal ────────────────────────────────────────────────────────────
  'legal_courtlistener',
  'legal_pacer',

  // Sanctions & ownership ────────────────────────────────────────────
  'sanctions_ofac',
  'open_corporates',
  'icij_offshore',
  'open_ownership',

  // Macroeconomic ────────────────────────────────────────────────────
  'world_bank',
  'fred_macro',
  'earnings_transcripts',

  // Environment & infrastructure ─────────────────────────────────────
  'epa_enforcement',
  'energy_eia',
  'energy_entso',
  'seismic_usgs',
  'weather_noaa',

  // Internet health ──────────────────────────────────────────────────
  'internet_cloudflare',
  'internet_netblocks',
  'internet_ioda',

  // Food, health, displacement ───────────────────────────────────────
  'food_fews',
  'food_fao',
  'disease_who',
  'disease_promed',
  'displacement_unhcr',

  // Social (Stream 3) — Phase 9 integrations ────────────────────────
  'social_twitter',
  'social_telegram',
  'social_reddit',
  'social_wechat',
  'social_linkedin',
] as const

export type SignalType = typeof SIGNAL_TYPES[number]

// ── Trigger layers ────────────────────────────────────────────────────
export type TriggerLayer = 'category_trigger' | 'entity_trigger' | 'keyword_trigger'

// ── Queue status ──────────────────────────────────────────────────────
export type QueueStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'requires_approval'

// ── Case study divergence types ───────────────────────────────────────
export type DivergenceType =
  | 'narrative_contradicts_raw'   // coverage said X, raw data shows not-X
  | 'narrative_omits_raw'          // coverage didn't mention what raw data shows
  | 'raw_precedes_narrative'       // raw signal predates narrative breaking
  | 'raw_corroborates_narrative'   // raw data backs up coverage (still useful)

// ── Confidence level ──────────────────────────────────────────────────
export type ConfidenceLevel = 'low' | 'medium' | 'high'

// ── Bounding box (stored in RawSignalLayer.coordinates JSONB) ─────────
export interface BoundingBox {
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 1: signalCategory → signal-type mapping.
// When a StoryCluster's signalCategory matches a key, queue all listed sources.
// Lists are the full master-spec per-category fan-out. Every category
// includes at least one social signal (Stream 3) so psychological signal
// capture runs for every analysis — even economic policy and trade stories
// where WeChat or LinkedIn is the richer channel than Twitter.
// ═══════════════════════════════════════════════════════════════════════
export const SIGNAL_CATEGORY_SOURCES: Record<string, SignalType[]> = {
  military_conflict: [
    'satellite_optical',
    'satellite_radar',
    'satellite_fire',
    'aviation_adsb',
    'maritime_ais',
    'gdelt',
    'copernicus_emergency',
    'sanctions_ofac',
    'seismic_usgs',
    'internet_cloudflare',
    'energy_eia',
    'arms_transfer_sipri',
    'displacement_unhcr',
    'space_track',
    'social_twitter',
    'social_telegram',
  ],
  diplomatic_negotiation: [
    'aviation_adsb',
    'maritime_ais',
    'government_spending',
    'gdelt',
    'sanctions_ofac',
    'world_bank',
    'un_comtrade',
    'un_security_council',
    'arms_transfer_sipri',
    'open_corporates',
    'displacement_unhcr',
    'federal_register',
    'travel_advisory_us',
    'travel_advisory_uk',
    'social_twitter',
    'social_linkedin',
  ],
  trade_dispute: [
    'maritime_ais',
    'un_comtrade',
    'government_spending',
    'financial_commodity',
    'gdelt',
    'maritime_fishing',
    'shipping_rates',
    'port_state_control',
    'energy_eia',
    'open_corporates',
    'social_twitter',
    'social_reddit',
    'social_wechat',
  ],
  corporate_scandal: [
    'sec_filing',
    'legal_courtlistener',
    'financial_equity',
    'financial_options',
    'sanctions_ofac',
    'gdelt',
    'open_corporates',
    'icij_offshore',
    'earnings_transcripts',
    'federal_register',
    'social_twitter',
    'social_reddit',
    'social_linkedin',
  ],
  political_scandal: [
    'legal_courtlistener',
    'government_spending',
    'sanctions_ofac',
    'gdelt',
    'sec_filing',
    'open_corporates',
    'federal_register',
    'travel_advisory_us',
    'social_twitter',
    'social_telegram',
    'social_reddit',
  ],
  economic_policy: [
    'financial_equity',
    'financial_commodity',
    'government_spending',
    'world_bank',
    'un_comtrade',
    'gdelt',
    'fred_macro',
    'energy_eia',
    'food_fao',
    'shipping_rates',
    'earnings_transcripts',
    'federal_register',
    'social_twitter',
    'social_reddit',
    'social_wechat',
  ],
  civil_unrest: [
    'satellite_optical',
    'satellite_fire',
    'aviation_adsb',
    'gdelt',
    'copernicus_emergency',
    'satellite_crowdsourced',
    'internet_cloudflare',
    'internet_netblocks',
    'internet_ioda',
    'displacement_unhcr',
    'food_fews',
    'disease_who',
    'social_twitter',
    'social_telegram',
  ],
  environmental_event: [
    'satellite_optical',
    'satellite_radar',
    'satellite_fire',
    'nasa_earthdata',
    'gdelt',
    'epa_enforcement',
    'maritime_fishing',
    'seismic_usgs',
    'weather_noaa',
    'energy_eia',
    'energy_entso',
    'social_twitter',
    'social_reddit',
  ],
  election_coverage: [
    'gdelt',
    'government_spending',
    'sanctions_ofac',
    'legal_courtlistener',
    'internet_cloudflare',
    'internet_netblocks',
    'displacement_unhcr',
    'federal_register',
    'social_twitter',
    'social_telegram',
    'social_reddit',
  ],
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 3: keyword triggers. Scan the full analysis text for these terms.
// Case-insensitive whole-word matching. Many-to-many is expressed via
// duplicate entries — one per (signalType, keyword-set) pair.
//
// Social keywords deliberately target multiple platforms at once: a "leaked"
// story should fan out to Twitter/Telegram/Reddit simultaneously because
// the platforms cover different parts of the discourse.
// ═══════════════════════════════════════════════════════════════════════
export const KEYWORD_TRIGGERS: Array<{
  signalType: SignalType
  keywords: string[]
}> = [
  // ── Sanctions / legal / government ─────────────────────────────────
  {
    signalType: 'sanctions_ofac',
    keywords: ['sanctions', 'sanctioned', 'SDN'],
  },
  {
    signalType: 'legal_courtlistener',
    keywords: [
      'filed suit',
      'lawsuit',
      'litigation',
      'indicted',
      'criminal charges',
      'class action',
      'court filing',
    ],
  },
  {
    signalType: 'government_spending',
    keywords: [
      'contract awarded',
      'procurement',
      'federal contract',
      'government contract',
      'awarded',
    ],
  },
  {
    signalType: 'federal_register',
    keywords: ['regulation', 'proposed rule', 'final rule'],
  },
  {
    signalType: 'travel_advisory_us',
    keywords: ['travel warning', 'travel advisory'],
  },
  {
    signalType: 'travel_advisory_uk',
    keywords: ['travel warning', 'travel advisory'],
  },

  // ── Maritime / aviation / space ────────────────────────────────────
  {
    signalType: 'maritime_ais',
    keywords: ['vessel', 'tanker', 'cargo ship', 'naval', 'fleet', 'maritime'],
  },
  {
    signalType: 'maritime_fishing',
    keywords: ['fishing vessel', 'illegal fishing', 'EEZ'],
  },
  {
    signalType: 'aviation_adsb',
    keywords: [
      'military aircraft',
      'fighter jet',
      'airspace closure',
      'flight restriction',
    ],
  },
  {
    signalType: 'space_track',
    keywords: ['satellite launch', 'orbital launch'],
  },

  // ── Satellite / environment ────────────────────────────────────────
  {
    signalType: 'satellite_optical',
    keywords: [
      'wildfire',
      'explosion',
      'airstrike',
      'bombing',
      'strike',
      'ordnance',
      'satellite imagery',
    ],
  },
  {
    signalType: 'seismic_usgs',
    keywords: ['earthquake', 'seismic', 'tremor', 'magnitude'],
  },
  {
    signalType: 'weather_noaa',
    keywords: ['extreme weather', 'hurricane', 'typhoon', 'tornado'],
  },

  // ── Infrastructure (internet, energy, shipping) ────────────────────
  {
    signalType: 'internet_cloudflare',
    keywords: ['internet shutdown', 'censorship', 'outage', 'BGP'],
  },
  {
    signalType: 'internet_netblocks',
    keywords: ['internet shutdown', 'censorship', 'outage', 'BGP'],
  },
  {
    signalType: 'energy_entso',
    keywords: ['power outage', 'grid failure', 'blackout'],
  },
  {
    signalType: 'energy_eia',
    keywords: ['oil', 'natural gas', 'energy production', 'refinery'],
  },
  {
    signalType: 'shipping_rates',
    keywords: ['container rates', 'freight rates', 'shipping costs'],
  },

  // ── Food / health / displacement ───────────────────────────────────
  {
    signalType: 'food_fews',
    keywords: ['food insecurity', 'famine', 'drought'],
  },
  {
    signalType: 'food_fao',
    keywords: ['food price', 'wheat', 'grain', 'commodity price'],
  },
  {
    signalType: 'disease_who',
    keywords: ['outbreak', 'epidemic', 'disease cluster'],
  },
  {
    signalType: 'displacement_unhcr',
    keywords: ['refugee', 'displaced', 'displacement'],
  },

  // ── Financial / corporate ──────────────────────────────────────────
  {
    signalType: 'sec_filing',
    keywords: ['SEC filing', 'insider trading', 'material event'],
  },
  {
    signalType: 'fred_macro',
    keywords: ['interest rate', 'inflation', 'GDP', 'federal reserve'],
  },
  {
    signalType: 'open_corporates',
    keywords: ['offshore', 'shell company', 'beneficial owner', 'tax haven'],
  },
  {
    signalType: 'icij_offshore',
    keywords: ['offshore', 'shell company', 'beneficial owner', 'tax haven'],
  },

  // ── Geopolitics ────────────────────────────────────────────────────
  {
    signalType: 'arms_transfer_sipri',
    keywords: ['arms transfer', 'weapons shipment', 'military sale'],
  },

  // ── Social layer (Stream 3) ────────────────────────────────────────
  // Many keywords trigger multiple social platforms simultaneously because
  // each captures a different slice of the unfiltered discourse.
  {
    signalType: 'social_twitter',
    keywords: [
      'viral',
      'trending',
      'breaking',
      'leaked',
      'leak',
      'whistleblower',
      'protest',
      'demonstration',
      'rally',
      'rumor',
      'unconfirmed',
      'CEO',
      'executive',
      'appointed',
      'resigned',
    ],
  },
  {
    signalType: 'social_telegram',
    keywords: [
      'leaked',
      'leak',
      'whistleblower',
      'protest',
      'demonstration',
      'rally',
    ],
  },
  {
    signalType: 'social_reddit',
    keywords: [
      'leaked',
      'leak',
      'whistleblower',
      'rumor',
      'unconfirmed',
    ],
  },
  {
    signalType: 'social_linkedin',
    keywords: ['CEO', 'executive', 'appointed', 'resigned'],
  },
]

// ═══════════════════════════════════════════════════════════════════════
// LAYER 2: entity triggers — maritime chokepoint list.
// If any of these names appears in the cluster entities, add maritime_ais.
// Async entity matchers (OFAC SDN lookup, Copernicus activation check,
// ICIJ Offshore Leaks, OpenCorporates, SIPRI arms transfer countries)
// live inside their integration modules and fire from the queue runner
// as side-effect queue entries. See queue.ts comments.
// ═══════════════════════════════════════════════════════════════════════
export const MARITIME_CHOKEPOINTS = [
  'Strait of Hormuz',
  'Red Sea',
  'Black Sea',
  'South China Sea',
  'Suez Canal',
  'Bosphorus',
  'Strait of Malacca',
  'Taiwan Strait',
  'Gulf of Aden',
  'Persian Gulf',
  'Strait of Gibraltar',
  'Strait of Bab-el-Mandeb',
]

// ── PACER doc cost estimates ──────────────────────────────────────────
// From spec: pages and cost-per-doc estimates surfaced in PACER approval UI.
// Federal court doc billing is $0.10/page capped at $3.00 per doc; the cost
// column below uses the page cap logic already built in.
export const PACER_DOC_ESTIMATES: Record<
  string,
  { pages: number; costUsd: number }
> = {
  complaint: { pages: 60, costUsd: 6 },
  amended_complaint: { pages: 60, costUsd: 6 },
  motion_summary_judgment: { pages: 50, costUsd: 5 },
  exhibit_package: { pages: 300, costUsd: 30 },
  full_docket_sheet: { pages: 30, costUsd: 3 },
  trial_transcript: { pages: 500, costUsd: 50 },
}
