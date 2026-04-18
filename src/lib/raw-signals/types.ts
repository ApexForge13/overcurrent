/**
 * Raw Signal Layer — shared types and constants.
 *
 * ADMIN-ONLY. Never surface on public-facing pages. All references to these
 * tables must be guarded by requireAdmin() at the API layer.
 */

// ── Signal types (must match RawSignalLayer.signalType string) ────────
export const SIGNAL_TYPES = [
  'gdelt',
  'maritime_ais',
  'maritime_fishing',
  'aviation_adsb',
  'financial_equity',
  'financial_options',
  'financial_commodity',
  'financial_crypto',
  'government_spending',
  'legal_courtlistener',
  'legal_pacer',
  'sec_filing',
  'satellite_optical',
  'satellite_radar',
  'satellite_fire',
  'satellite_crowdsourced',
  'copernicus_emergency',
  'sanctions_ofac',
  'world_bank',
  'un_comtrade',
  'epa_enforcement',
  'fred_macro',
  'nasa_earthdata',
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
  ],
  diplomatic_negotiation: [
    'aviation_adsb',
    'maritime_ais',
    'government_spending',
    'gdelt',
    'sanctions_ofac',
    'world_bank',
    'un_comtrade',
  ],
  trade_dispute: [
    'maritime_ais',
    'un_comtrade',
    'government_spending',
    'financial_commodity',
    'gdelt',
    'maritime_fishing',
  ],
  corporate_scandal: [
    'sec_filing',
    'legal_courtlistener',
    'financial_equity',
    'financial_options',
    'sanctions_ofac',
    'gdelt',
  ],
  political_scandal: [
    'legal_courtlistener',
    'government_spending',
    'sanctions_ofac',
    'gdelt',
    'sec_filing',
  ],
  economic_policy: [
    'financial_equity',
    'financial_commodity',
    'government_spending',
    'world_bank',
    'un_comtrade',
    'gdelt',
    'fred_macro',
  ],
  civil_unrest: [
    'satellite_optical',
    'satellite_fire',
    'aviation_adsb',
    'gdelt',
    'copernicus_emergency',
    'satellite_crowdsourced',
  ],
  environmental_event: [
    'satellite_optical',
    'satellite_radar',
    'satellite_fire',
    'nasa_earthdata',
    'gdelt',
    'epa_enforcement',
    'maritime_fishing',
  ],
  election_coverage: [
    'gdelt',
    'government_spending',
    'sanctions_ofac',
    'legal_courtlistener',
  ],
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 3: keyword triggers. Scan the full analysis text for these terms.
// Case-insensitive whole-word matching. Returns [signalType, matchedKeyword].
// ═══════════════════════════════════════════════════════════════════════
export const KEYWORD_TRIGGERS: Array<{
  signalType: SignalType
  keywords: string[]
}> = [
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
    signalType: 'maritime_ais',
    keywords: ['vessel', 'tanker', 'cargo ship', 'naval', 'fleet', 'maritime'],
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
    signalType: 'satellite_optical',
    keywords: [
      'wildfire',
      'explosion',
      'airstrike',
      'bombing',
      'strike',
      'satellite imagery',
    ],
  },
  {
    signalType: 'maritime_fishing',
    keywords: ['fishing vessel', 'illegal fishing', 'EEZ'],
  },
  {
    signalType: 'sec_filing',
    keywords: ['SEC filing', 'insider trading', 'material event'],
  },
  {
    signalType: 'fred_macro',
    keywords: ['interest rate', 'inflation', 'GDP', 'federal reserve'],
  },
]

// ═══════════════════════════════════════════════════════════════════════
// LAYER 2: entity triggers — maritime chokepoint list.
// If any of these names appears in the cluster entities, add maritime_ais.
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
