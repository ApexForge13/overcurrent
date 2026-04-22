/**
 * ENTSO-E — European electricity transparency platform.
 *
 * ── Environment Variables: ENTSOE_API_KEY (required, free registration).
 * ── Cost: Free.
 * ── What: Pulls European grid generation + cross-border flows + load data.
 *    Grid stress / cross-border flow anomalies matter for stories about
 *    European energy policy, supply disruptions, or sanctions.
 *
 * Stubbed live fetch: the ENTSO-E Transparency Platform uses an XML API
 * with narrow document codes. A rigorous query needs a country + date
 * range. For Phase 6 this integration is scaffolded — when a proper
 * document-code + zone mapping is ready (Phase 10 backfill has a related
 * baseline), the fetch body below is the landing spot.
 */

import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const API_URL = 'https://web-api.tp.entsoe.eu/api'

export const entsoEnergyRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  const key = process.env.ENTSOE_API_KEY
  if (!key) {
    console.warn('[raw-signals/entso-e] ENTSOE_API_KEY missing — returning skipped result')
    return null
  }

  // Best-effort probe: ping the API with a trivial request to confirm
  // connectivity + key validity. A real query needs specific documentType,
  // in_Domain, out_Domain codes — deferred to Phase 10 backfill harness.
  try {
    const params = new URLSearchParams({
      securityToken: key,
      documentType: 'A44',
      in_Domain: '10YFR-RTE------C',
      out_Domain: '10YFR-RTE------C',
      periodStart: '202604180000',
      periodEnd: '202604190000',
    })
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/xml' },
    })
    const ok = res.ok

    return {
      rawContent: {
        note: 'ENTSO-E scaffolded — full grid query pending Phase 10 backfill harness',
        probe: { ok, status: res.status },
        cluster: cluster.id.substring(0, 8),
      },
      haikuSummary: ok
        ? 'ENTSO-E API reachable; full grid query deferred'
        : `ENTSO-E HTTP ${res.status}`,
      signalSource: 'entso-e',
      captureDate: cluster.firstDetectedAt,
      coordinates: null,
      divergenceFlag: false,
      divergenceDescription: null,
      confidenceLevel: 'low' as const,
    }
  } catch (err) {
    console.warn('[raw-signals/entso-e] probe failed:', err instanceof Error ? err.message : err)
    return null
  }
}
