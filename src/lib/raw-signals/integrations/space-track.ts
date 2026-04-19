/**
 * Space-Track.org — space_track.
 *
 * ── Environment Variables: SPACETRACK_USERNAME + SPACETRACK_PASSWORD (required).
 * ── Cost: Free (public account via 18 SPCS).
 * ── What: Queries Space-Track's session-authenticated API for recent
 *    GP (general perturbation) orbital element updates on payloads
 *    flagged as military/reconnaissance by country, then Haiku-assesses
 *    whether recent satellite repositioning aligns with the story's
 *    geographic focus.
 *
 *    Space-Track uses cookie-session auth: POST login → reuse cookie for
 *    queries until expiry. Token is cached across runner invocations.
 *
 *    For military satellite detection we filter OBJECT_TYPE='PAYLOAD'
 *    and COUNTRY in a set of typically-military launch nations
 *    (US / CIS / PRC / FR / UK / ISRL / IRAN / DPRK). Orbit-over-region
 *    detection is deferred to Phase 10 backfill (simplified orbit math);
 *    for now we return recent GP updates as a scaffold, with Haiku
 *    assessing relevance.
 *
 * Register free account at: https://www.space-track.org/auth/createAccount
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 25_000
const LOGIN_URL = 'https://www.space-track.org/ajaxauth/login'
const QUERY_URL = 'https://www.space-track.org/basicspacedata/query'

// Session cookie cache — Space-Track cookies live ~2h
let cachedCookie: { value: string; expiresAt: number } | null = null

async function getSessionCookie(): Promise<string | null> {
  const user = process.env.SPACETRACK_USERNAME
  const pass = process.env.SPACETRACK_PASSWORD
  if (!user || !pass) {
    console.warn('[raw-signals/space-track] SPACETRACK_USERNAME/_PASSWORD missing')
    return null
  }

  if (cachedCookie && cachedCookie.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedCookie.value
  }

  try {
    const body = new URLSearchParams({ identity: user, password: pass })
    const res = await fetchWithTimeout(LOGIN_URL, TIMEOUT_MS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      console.warn(`[raw-signals/space-track] login HTTP ${res.status}`)
      return null
    }
    const setCookie = res.headers.get('set-cookie') ?? ''
    const match = /chocolatechip=([^;]+)/i.exec(setCookie)
    if (!match) {
      console.warn('[raw-signals/space-track] login succeeded but no session cookie returned')
      return null
    }
    cachedCookie = {
      value: `chocolatechip=${match[1]}`,
      expiresAt: Date.now() + 90 * 60 * 1000, // 90min — safely inside the 2h server-side TTL
    }
    return cachedCookie.value
  } catch (err) {
    console.warn('[raw-signals/space-track] login failed:', err instanceof Error ? err.message : err)
    return null
  }
}

interface OrbitalRecord {
  objectName: string
  noradCatId: string
  country: string
  launchDate?: string
  epoch: string // most recent GP update timestamp
  inclinationDeg?: number
  apogeeKm?: number
  perigeeKm?: number
  period?: number
  objectType?: string
}

const MILITARY_RELEVANT_COUNTRIES = ['US', 'CIS', 'PRC', 'FR', 'UK', 'ISRL', 'IRAN', 'PRK', 'JPN', 'ROK', 'IND']

async function fetchRecentMilitaryUpdates(since: Date): Promise<OrbitalRecord[]> {
  const cookie = await getSessionCookie()
  if (!cookie) return []

  const epochFrom = new Date(since.getTime() - 72 * 60 * 60 * 1000).toISOString().split('.')[0]
  // Query: GP records with EPOCH >= last 72h from military-relevant countries
  const countryFilter = MILITARY_RELEVANT_COUNTRIES.join(',')
  const query =
    `/class/gp/EPOCH/%3E${encodeURIComponent(epochFrom)}` +
    `/COUNTRY_CODE/${encodeURIComponent(countryFilter)}` +
    `/OBJECT_TYPE/PAYLOAD` +
    `/orderby/EPOCH%20desc/limit/50/format/json`

  try {
    const res = await fetchWithTimeout(`${QUERY_URL}${query}`, TIMEOUT_MS, {
      headers: { Cookie: cookie, Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/space-track] query HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as Array<Record<string, unknown>>
    return (Array.isArray(data) ? data : []).slice(0, 50).map((r) => ({
      objectName: String(r.OBJECT_NAME ?? ''),
      noradCatId: String(r.NORAD_CAT_ID ?? ''),
      country: String(r.COUNTRY_CODE ?? ''),
      launchDate: r.LAUNCH_DATE ? String(r.LAUNCH_DATE) : undefined,
      epoch: String(r.EPOCH ?? ''),
      inclinationDeg: typeof r.INCLINATION === 'number' ? (r.INCLINATION as number) : parseFloat(String(r.INCLINATION ?? 'NaN')) || undefined,
      apogeeKm: typeof r.APOAPSIS === 'number' ? (r.APOAPSIS as number) : parseFloat(String(r.APOAPSIS ?? 'NaN')) || undefined,
      perigeeKm: typeof r.PERIAPSIS === 'number' ? (r.PERIAPSIS as number) : parseFloat(String(r.PERIAPSIS ?? 'NaN')) || undefined,
      period: typeof r.PERIOD === 'number' ? (r.PERIOD as number) : parseFloat(String(r.PERIOD ?? 'NaN')) || undefined,
      objectType: r.OBJECT_TYPE ? String(r.OBJECT_TYPE) : undefined,
    }))
  } catch (err) {
    console.warn('[raw-signals/space-track] query failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess recent satellite orbital updates (GP element sets from Space-Track) against a news story.
Given a story and a list of satellites from military-relevant countries that had orbital element updates in the last 72h, return:
- relevantSatellites: count that likely correspond to the story's region/context
- repositioningSignal: true if orbital parameters (inclination, apogee/perigee, period) suggest deliberate repositioning over the story's geography
- description: 1-2 sentences or empty
Return JSON only:
{ "relevantSatellites": 0, "repositioningSignal": false, "description": "" }`

export const spaceTrackRunner: IntegrationRunner = async (ctx) => {
  const { cluster } = ctx
  const updates = await fetchRecentMilitaryUpdates(cluster.firstDetectedAt)

  if (updates.length === 0) {
    return {
      rawContent: { note: 'Space-Track returned empty (no creds, auth failure, or no recent updates)' },
      haikuSummary: 'No Space-Track orbital updates retrieved.',
      signalSource: 'space-track', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { relevantSatellites: 0, repositioningSignal: false, description: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nRecent GP updates (72h, military-relevant countries):\n${updates.slice(0, 15).map((u, i) => `${i + 1}. ${u.objectName} (${u.country}) NORAD ${u.noradCatId} | inc=${u.inclinationDeg?.toFixed(1) ?? '?'}° | apo=${u.apogeeKm?.toFixed(0) ?? '?'}km | peri=${u.perigeeKm?.toFixed(0) ?? '?'}km | epoch=${u.epoch}`).join('\n')}`,
      agentType: 'raw_signal_space_track', maxTokens: 400,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/space-track] Haiku failed:', err instanceof Error ? err.message : err)
  }

  return {
    rawContent: { updates: updates.slice(0, 15), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.relevantSatellites} relevant satellite updates${assessment.repositioningSignal ? ' (repositioning signal)' : ''}`,
    signalSource: 'space-track', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag: assessment.repositioningSignal,
    divergenceDescription: assessment.repositioningSignal ? assessment.description : null,
    confidenceLevel: assessment.repositioningSignal ? 'medium' : 'low',
  }
}
