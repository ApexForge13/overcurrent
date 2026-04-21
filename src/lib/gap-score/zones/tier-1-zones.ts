// src/lib/gap-score/zones/tier-1-zones.ts
//
// Tier 1 Maritime Monitoring Zones — 43 high-priority zones globally.
// (Planning doc header said "40"; the actual catalog below breaks down as
// 10 crude export + 1 refined products + 6 crude import + 5 lng export +
// 7 container + 4 grain + 3 metals + 7 chokepoint = 43.)
//
// Extracted from docs/plans/2026-04-21-tier-1-zones.md during Phase 1b.
// Only code-level change from the source artifact: MonitoringZone.country is
// typed as `string | null`. The original spec declared `string` but three
// chokepoint entries (Hormuz, Malacca, Bab el-Mandeb) set null because those
// straits span multiple countries. Under strict-mode TypeScript the `string`
// declaration was a compile error — fixed on extract per the planning doc's
// instructions.
//
// Each zone is a polygon defined by a bounding box (for simplicity; can be
// refined to actual polygon shapes in v1.1). Used for Datalastic AIS queries.
//
// Zones are grouped by commodity relevance. When adding new zones (Tier 2+),
// follow the same structure and append to the appropriate category section.
//
// PHASE 1 DISCIPLINE:
// - Baseline collection starts Day 1 for all zones
// - Triggers begin firing after 30 days of per-zone observation data
// - Until then, zones display "calibrating" state on the dashboard

export type ZoneCategory =
  | 'crude_export'
  | 'crude_import'
  | 'lng_export'
  | 'lng_import'
  | 'container'
  | 'grain'
  | 'metals'
  | 'chokepoint'
  | 'refined_products'

export interface MonitoringZone {
  /** Stable identifier — referenced by ZoneBaseline.zoneId. */
  id: string
  /** Human-readable name. */
  name: string
  /**
   * ISO 3166-1 alpha-2 country code, OR null for chokepoints that span
   * multiple countries (Hormuz, Malacca, Bab el-Mandeb).
   */
  country: string | null
  region: string
  category: ZoneCategory
  boundingBox: {
    minLat: number
    maxLat: number
    minLong: number
    maxLong: number
  }
  /** TrackedEntity.identifier values rescored when triggers fire on this zone. */
  relevantCommodities: string[]
  /** AIS ship-type codes to include in Datalastic queries. */
  shipTypeFilter: string[]
  /** Operational context. */
  notes?: string
}

export const TIER_1_ZONES: readonly MonitoringZone[] = [
  // ========== CRUDE OIL EXPORT TERMINALS ==========
  {
    id: 'ras_tanura',
    name: 'Ras Tanura',
    country: 'SA',
    region: 'persian_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 26.60, maxLat: 26.80, minLong: 50.10, maxLong: 50.35 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'vlcc'],
    notes: 'Largest crude export terminal globally. Saudi Aramco operated. Baseline ~8-15 tankers typical.',
  },
  {
    id: 'jebel_dhanna',
    name: 'Jebel Dhanna / Ruwais',
    country: 'AE',
    region: 'persian_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 24.05, maxLat: 24.25, minLong: 52.55, maxLong: 52.80 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'vlcc'],
  },
  {
    id: 'fujairah',
    name: 'Fujairah',
    country: 'AE',
    region: 'persian_gulf',
    category: 'refined_products',
    boundingBox: { minLat: 25.10, maxLat: 25.35, minLong: 56.30, maxLong: 56.55 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'product_tanker', 'crude_oil_tanker'],
    notes: 'Major bunkering hub east of Strait of Hormuz. Signals related to Hormuz disruption.',
  },
  {
    id: 'kharg_island',
    name: 'Kharg Island',
    country: 'IR',
    region: 'persian_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 29.20, maxLat: 29.30, minLong: 50.25, maxLong: 50.40 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
    notes: 'Iran primary crude export terminal. Sanctions-era observations differ from normal.',
  },
  {
    id: 'basrah_oil_terminal',
    name: 'Basrah Oil Terminal',
    country: 'IQ',
    region: 'persian_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 29.65, maxLat: 29.80, minLong: 48.70, maxLong: 48.95 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'vlcc'],
  },
  {
    id: 'primorsk',
    name: 'Primorsk',
    country: 'RU',
    region: 'baltic',
    category: 'crude_export',
    boundingBox: { minLat: 60.30, maxLat: 60.40, minLong: 28.55, maxLong: 28.75 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
    notes: 'Russian Baltic crude export. Post-2022 traffic patterns significantly changed.',
  },
  {
    id: 'novorossiysk',
    name: 'Novorossiysk',
    country: 'RU',
    region: 'black_sea',
    category: 'crude_export',
    boundingBox: { minLat: 44.65, maxLat: 44.80, minLong: 37.70, maxLong: 37.95 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
    notes: 'Russian Black Sea crude export. CPC Blend blended here.',
  },
  {
    id: 'houston_ship_channel',
    name: 'Houston Ship Channel',
    country: 'US',
    region: 'us_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 29.60, maxLat: 29.80, minLong: -95.15, maxLong: -94.85 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'product_tanker'],
    notes: 'US Gulf crude export hub. High volume, complex traffic.',
  },
  {
    id: 'loop_offshore',
    name: 'LOOP (Louisiana Offshore Oil Port)',
    country: 'US',
    region: 'us_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 28.85, maxLat: 28.95, minLong: -90.10, maxLong: -89.95 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['vlcc', 'crude_oil_tanker'],
    notes: 'Only US deepwater port able to accommodate VLCCs fully laden.',
  },
  {
    id: 'corpus_christi',
    name: 'Corpus Christi',
    country: 'US',
    region: 'us_gulf',
    category: 'crude_export',
    boundingBox: { minLat: 27.75, maxLat: 27.90, minLong: -97.45, maxLong: -97.20 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
    notes: 'Fastest-growing US crude export terminal. Permian crude outlet.',
  },
  {
    id: 'ceyhan',
    name: 'Ceyhan',
    country: 'TR',
    region: 'mediterranean',
    category: 'crude_export',
    boundingBox: { minLat: 36.80, maxLat: 36.95, minLong: 35.80, maxLong: 36.05 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
    notes: 'Iraqi/Kurdish crude via BTC and Kirkuk-Ceyhan pipelines. Conflict-sensitive.',
  },

  // ========== CRUDE IMPORT TERMINALS ==========
  {
    id: 'ningbo_zhoushan',
    name: 'Ningbo-Zhoushan',
    country: 'CN',
    region: 'china_east_coast',
    category: 'crude_import',
    boundingBox: { minLat: 29.70, maxLat: 30.20, minLong: 121.50, maxLong: 122.50 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'vlcc'],
    notes: 'Largest port globally by cargo tonnage. Primary Chinese crude import.',
  },
  {
    id: 'qingdao',
    name: 'Qingdao',
    country: 'CN',
    region: 'china_east_coast',
    category: 'crude_import',
    boundingBox: { minLat: 35.90, maxLat: 36.15, minLong: 120.00, maxLong: 120.35 },
    relevantCommodities: ['CL=F', 'BZ=F', 'HG=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'bulk_carrier'],
    notes: 'Major Chinese crude and iron ore import.',
  },
  {
    id: 'shanghai_crude',
    name: 'Shanghai Crude Terminals',
    country: 'CN',
    region: 'china_east_coast',
    category: 'crude_import',
    boundingBox: { minLat: 30.85, maxLat: 31.25, minLong: 121.80, maxLong: 122.20 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
  },
  {
    id: 'rotterdam',
    name: 'Rotterdam',
    country: 'NL',
    region: 'north_sea',
    category: 'crude_import',
    boundingBox: { minLat: 51.85, maxLat: 52.00, minLong: 3.95, maxLong: 4.35 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'container_ship', 'product_tanker'],
    notes: 'Largest European port. Crude import + refining + container. Multi-category.',
  },
  {
    id: 'sikka_vadinar',
    name: 'Sikka / Vadinar',
    country: 'IN',
    region: 'india_west_coast',
    category: 'crude_import',
    boundingBox: { minLat: 22.35, maxLat: 22.55, minLong: 69.80, maxLong: 70.05 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'vlcc'],
    notes: 'Reliance + Nayara refineries. Primary Indian crude import.',
  },
  {
    id: 'yeosu_ulsan',
    name: 'Yeosu / Ulsan',
    country: 'KR',
    region: 'korea',
    category: 'crude_import',
    boundingBox: { minLat: 34.70, maxLat: 35.60, minLong: 127.60, maxLong: 129.50 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'product_tanker'],
    notes: 'Combined zone covering South Korean refining complex.',
  },

  // ========== LNG EXPORT TERMINALS ==========
  {
    id: 'ras_laffan',
    name: 'Ras Laffan',
    country: 'QA',
    region: 'persian_gulf',
    category: 'lng_export',
    boundingBox: { minLat: 25.85, maxLat: 26.05, minLong: 51.50, maxLong: 51.75 },
    relevantCommodities: ['NG=F'],
    shipTypeFilter: ['lng_carrier'],
    notes: 'Largest LNG export facility globally (Qatar).',
  },
  {
    id: 'sabine_pass',
    name: 'Sabine Pass',
    country: 'US',
    region: 'us_gulf',
    category: 'lng_export',
    boundingBox: { minLat: 29.70, maxLat: 29.85, minLong: -93.90, maxLong: -93.75 },
    relevantCommodities: ['NG=F'],
    shipTypeFilter: ['lng_carrier'],
  },
  {
    id: 'corpus_christi_lng',
    name: 'Corpus Christi LNG',
    country: 'US',
    region: 'us_gulf',
    category: 'lng_export',
    boundingBox: { minLat: 27.80, maxLat: 27.90, minLong: -97.15, maxLong: -97.00 },
    relevantCommodities: ['NG=F'],
    shipTypeFilter: ['lng_carrier'],
  },
  {
    id: 'freeport_lng',
    name: 'Freeport LNG',
    country: 'US',
    region: 'us_gulf',
    category: 'lng_export',
    boundingBox: { minLat: 28.90, maxLat: 29.00, minLong: -95.35, maxLong: -95.25 },
    relevantCommodities: ['NG=F'],
    shipTypeFilter: ['lng_carrier'],
  },
  {
    id: 'gorgon_wheatstone',
    name: 'Gorgon / Wheatstone',
    country: 'AU',
    region: 'australia_west',
    category: 'lng_export',
    boundingBox: { minLat: -21.50, maxLat: -20.50, minLong: 114.80, maxLong: 116.00 },
    relevantCommodities: ['NG=F'],
    shipTypeFilter: ['lng_carrier'],
    notes: 'Combined Australian NW Shelf LNG export.',
  },

  // ========== CONTAINER / TRADE HUBS ==========
  {
    id: 'shanghai_container',
    name: 'Shanghai Container Terminals',
    country: 'CN',
    region: 'china_east_coast',
    category: 'container',
    boundingBox: { minLat: 30.60, maxLat: 30.90, minLong: 121.80, maxLong: 122.10 },
    relevantCommodities: ['SPY', 'QQQ', 'FXI'],
    shipTypeFilter: ['container_ship'],
    notes: 'Largest container port globally. Trade/global-economy signal.',
  },
  {
    id: 'singapore_transit',
    name: 'Singapore',
    country: 'SG',
    region: 'southeast_asia',
    category: 'container',
    boundingBox: { minLat: 1.20, maxLat: 1.35, minLong: 103.60, maxLong: 104.10 },
    relevantCommodities: ['CL=F', 'BZ=F', 'SPY'],
    shipTypeFilter: ['container_ship', 'tanker', 'bulk_carrier'],
    notes: 'Critical transit and bunkering. Multi-category signal.',
  },
  {
    id: 'shenzhen',
    name: 'Shenzhen (Yantian)',
    country: 'CN',
    region: 'china_south',
    category: 'container',
    boundingBox: { minLat: 22.55, maxLat: 22.70, minLong: 114.10, maxLong: 114.40 },
    relevantCommodities: ['SPY', 'QQQ', 'FXI'],
    shipTypeFilter: ['container_ship'],
  },
  {
    id: 'busan',
    name: 'Busan',
    country: 'KR',
    region: 'korea',
    category: 'container',
    boundingBox: { minLat: 35.05, maxLat: 35.20, minLong: 128.95, maxLong: 129.15 },
    relevantCommodities: ['SPY', 'QQQ'],
    shipTypeFilter: ['container_ship'],
  },
  {
    id: 'la_long_beach',
    name: 'Los Angeles / Long Beach',
    country: 'US',
    region: 'us_west_coast',
    category: 'container',
    boundingBox: { minLat: 33.70, maxLat: 33.80, minLong: -118.30, maxLong: -118.15 },
    relevantCommodities: ['SPY', 'QQQ'],
    shipTypeFilter: ['container_ship'],
    notes: 'Largest US port complex. US import/consumer demand signal.',
  },
  {
    id: 'jebel_ali',
    name: 'Jebel Ali',
    country: 'AE',
    region: 'persian_gulf',
    category: 'container',
    boundingBox: { minLat: 24.95, maxLat: 25.05, minLong: 55.00, maxLong: 55.15 },
    relevantCommodities: ['SPY'],
    shipTypeFilter: ['container_ship'],
    notes: 'Largest Middle East port. Multi-regional trade hub.',
  },
  {
    id: 'antwerp',
    name: 'Antwerp',
    country: 'BE',
    region: 'north_sea',
    category: 'container',
    boundingBox: { minLat: 51.25, maxLat: 51.40, minLong: 4.20, maxLong: 4.45 },
    relevantCommodities: ['SPY'],
    shipTypeFilter: ['container_ship'],
  },

  // ========== GRAIN / AG EXPORT ==========
  {
    id: 'new_orleans_mississippi',
    name: 'New Orleans / Mississippi River Complex',
    country: 'US',
    region: 'us_gulf',
    category: 'grain',
    boundingBox: { minLat: 29.10, maxLat: 30.00, minLong: -91.00, maxLong: -89.90 },
    relevantCommodities: ['ZW=F', 'ZC=F', 'ZS=F'],
    shipTypeFilter: ['bulk_carrier'],
    notes: 'Primary US grain export outlet. Mississippi River feeds.',
  },
  {
    id: 'santos',
    name: 'Santos',
    country: 'BR',
    region: 'brazil',
    category: 'grain',
    boundingBox: { minLat: -24.00, maxLat: -23.85, minLong: -46.45, maxLong: -46.25 },
    relevantCommodities: ['ZS=F', 'ZC=F'],
    shipTypeFilter: ['bulk_carrier'],
    notes: 'Primary Brazilian soy/corn export. Seasonal patterns critical.',
  },
  {
    id: 'paranagua',
    name: 'Paranaguá',
    country: 'BR',
    region: 'brazil',
    category: 'grain',
    boundingBox: { minLat: -25.60, maxLat: -25.45, minLong: -48.55, maxLong: -48.35 },
    relevantCommodities: ['ZS=F', 'ZC=F'],
    shipTypeFilter: ['bulk_carrier'],
  },
  {
    id: 'rosario',
    name: 'Rosario',
    country: 'AR',
    region: 'south_america',
    category: 'grain',
    boundingBox: { minLat: -33.05, maxLat: -32.80, minLong: -60.75, maxLong: -60.55 },
    relevantCommodities: ['ZS=F', 'ZC=F', 'ZW=F'],
    shipTypeFilter: ['bulk_carrier'],
    notes: 'Primary Argentine grain export on Paraná River.',
  },

  // ========== METALS / IRON ORE ==========
  {
    id: 'port_hedland',
    name: 'Port Hedland',
    country: 'AU',
    region: 'australia_west',
    category: 'metals',
    boundingBox: { minLat: -20.35, maxLat: -20.20, minLong: 118.50, maxLong: 118.70 },
    relevantCommodities: ['HG=F'],
    shipTypeFilter: ['bulk_carrier'],
    notes: 'Largest iron ore export port globally. BHP + Rio Tinto + FMG.',
  },
  {
    id: 'dampier',
    name: 'Dampier',
    country: 'AU',
    region: 'australia_west',
    category: 'metals',
    boundingBox: { minLat: -20.70, maxLat: -20.60, minLong: 116.65, maxLong: 116.80 },
    relevantCommodities: ['HG=F'],
    shipTypeFilter: ['bulk_carrier'],
  },
  {
    id: 'tubarao',
    name: 'Tubarão',
    country: 'BR',
    region: 'brazil',
    category: 'metals',
    boundingBox: { minLat: -20.30, maxLat: -20.25, minLong: -40.25, maxLong: -40.15 },
    relevantCommodities: ['HG=F'],
    shipTypeFilter: ['bulk_carrier'],
    notes: 'Vale primary iron ore export.',
  },

  // ========== CHOKEPOINTS ==========
  // These three have country: null because they span multiple countries.
  // The string | null type on MonitoringZone.country exists for exactly these.
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    country: null,
    region: 'persian_gulf',
    category: 'chokepoint',
    boundingBox: { minLat: 26.20, maxLat: 26.80, minLong: 56.00, maxLong: 57.00 },
    relevantCommodities: ['CL=F', 'BZ=F', 'NG=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'vlcc', 'lng_carrier', 'product_tanker'],
    notes: '~20% of global oil transit. Highest-priority chokepoint. Any unusual pattern = major signal.',
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    country: null,
    region: 'southeast_asia',
    category: 'chokepoint',
    boundingBox: { minLat: 1.00, maxLat: 3.50, minLong: 100.00, maxLong: 104.00 },
    relevantCommodities: ['CL=F', 'BZ=F', 'SPY'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker', 'container_ship'],
    notes: '~25% of global trade. Secondary oil chokepoint.',
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    country: 'EG',
    region: 'mediterranean',
    category: 'chokepoint',
    boundingBox: { minLat: 29.90, maxLat: 31.30, minLong: 32.30, maxLong: 32.60 },
    relevantCommodities: ['CL=F', 'BZ=F', 'SPY'],
    shipTypeFilter: ['tanker', 'container_ship', 'bulk_carrier'],
  },
  {
    id: 'bab_el_mandeb',
    name: 'Bab el-Mandeb / Red Sea',
    country: null,
    region: 'red_sea',
    category: 'chokepoint',
    boundingBox: { minLat: 12.00, maxLat: 13.00, minLong: 43.00, maxLong: 44.00 },
    relevantCommodities: ['CL=F', 'BZ=F', 'SPY'],
    shipTypeFilter: ['tanker', 'container_ship'],
    notes: 'Yemen coast. Houthi conflict-sensitive 2024+.',
  },
  {
    id: 'bosphorus',
    name: 'Bosphorus / Turkish Straits',
    country: 'TR',
    region: 'black_sea',
    category: 'chokepoint',
    boundingBox: { minLat: 40.90, maxLat: 41.40, minLong: 28.90, maxLong: 29.20 },
    relevantCommodities: ['CL=F', 'BZ=F', 'ZW=F'],
    shipTypeFilter: ['tanker', 'bulk_carrier'],
    notes: 'Russian Black Sea oil + Ukrainian grain transit.',
  },
  {
    id: 'panama_canal',
    name: 'Panama Canal',
    country: 'PA',
    region: 'caribbean',
    category: 'chokepoint',
    boundingBox: { minLat: 8.80, maxLat: 9.35, minLong: -80.00, maxLong: -79.40 },
    relevantCommodities: ['CL=F', 'BZ=F', 'SPY'],
    shipTypeFilter: ['tanker', 'container_ship'],
    notes: 'Drought-sensitive; reduced transit 2023-2024. Climate signal.',
  },
  {
    id: 'danish_straits',
    name: 'Danish Straits',
    country: 'DK',
    region: 'baltic',
    category: 'chokepoint',
    boundingBox: { minLat: 55.00, maxLat: 56.50, minLong: 10.50, maxLong: 13.00 },
    relevantCommodities: ['CL=F', 'BZ=F'],
    shipTypeFilter: ['tanker', 'crude_oil_tanker'],
    notes: 'Russian Baltic crude exit. Sanctions monitoring relevant.',
  },
]

// ============================================================================
// ZONE METRICS — what we measure per zone per observation
// ============================================================================

export type ZoneMetricName =
  | 'tankerCount'
  | 'containerShipCount'
  | 'bulkCarrierCount'
  | 'lngCarrierCount'

export const ZONE_METRIC_NAMES: readonly ZoneMetricName[] = Object.freeze([
  'tankerCount',
  'containerShipCount',
  'bulkCarrierCount',
  'lngCarrierCount',
])

export interface ZoneObservation {
  zoneId: string
  observedAt: Date
  tankerCount: number
  containerShipCount: number
  bulkCarrierCount: number
  lngCarrierCount: number
  totalShipCount: number
  averageDraft: number | null
  medianDwellHours: number | null
  entryCount24h: number
  exitCount24h: number
  metadata?: Record<string, unknown>
}

// ============================================================================
// TRIGGER DIRECTION CLASSIFIER
// ============================================================================

export function classifyZoneDirection(
  zone: MonitoringZone,
  _metric: ZoneMetricName,
  deviation: 'above_baseline' | 'below_baseline',
): { direction: -1 | 0 | 1; notes: string } {
  if (zone.category === 'chokepoint') {
    return {
      direction: 0,
      notes: 'chokepoint anomaly — direction ambiguous, treat as high-severity alert',
    }
  }

  const isExport = zone.category.includes('export')
  const isImport = zone.category.includes('import')

  if (isExport) {
    if (deviation === 'above_baseline') {
      return {
        direction: -1,
        notes: 'tanker buildup at export terminal → oversupply signal',
      }
    }
    return {
      direction: 1,
      notes: 'tanker drawdown at export terminal → tight supply signal',
    }
  }

  if (isImport) {
    if (deviation === 'above_baseline') {
      return {
        direction: 1,
        notes: 'tanker buildup at import terminal → demand arriving',
      }
    }
    return {
      direction: -1,
      notes: 'tanker drawdown at import terminal → demand softening',
    }
  }

  return { direction: 0, notes: 'classification not mapped' }
}
