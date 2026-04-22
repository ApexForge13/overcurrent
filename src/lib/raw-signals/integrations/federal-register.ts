/**
 * Federal Register — proposed + final US regulations.
 *
 * ── Environment Variables: None required.
 * ── Cost: Free.
 * ── What: Searches federalregister.gov/api/v1/articles for regulations
 *    touching cluster entities in the 90-day pre-story window. Flags
 *    divergence when a proposed or final rule is relevant but absent
 *    from the narrative.
 */

import { callClaude, HAIKU, parseJSON } from '@/lib/anthropic'
import { fetchWithTimeout } from '@/lib/utils'
import type { IntegrationRunner } from '../runner'

const TIMEOUT_MS = 20_000
const API_URL = 'https://www.federalregister.gov/api/v1/articles'
const WINDOW_DAYS = 90

interface Article {
  documentNumber: string
  title: string
  type: string // Rule, Proposed Rule, Notice, Presidential Document
  agencies: string[]
  publicationDate: string
  abstract?: string
  htmlUrl?: string
}

async function searchArticles(entities: string[], since: Date): Promise<Article[]> {
  const keywords = entities.filter((e) => e.length > 3).slice(0, 3)
  if (keywords.length === 0) return []

  const start = new Date(since.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    'conditions[term]': keywords.join(' '),
    'conditions[publication_date][gte]': start.toISOString().split('T')[0],
    'conditions[publication_date][lte]': since.toISOString().split('T')[0],
    'per_page': '25',
    'order': 'newest',
  })

  try {
    const res = await fetchWithTimeout(`${API_URL}?${params}`, TIMEOUT_MS, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn(`[raw-signals/federal-register] HTTP ${res.status}`)
      return []
    }
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    return (data.results ?? []).map((r) => ({
      documentNumber: String(r.document_number ?? ''),
      title: String(r.title ?? ''),
      type: String(r.type ?? ''),
      agencies: Array.isArray(r.agencies)
        ? (r.agencies as Array<{ name?: string }>).map((a) => a.name ?? '').filter(Boolean)
        : [],
      publicationDate: String(r.publication_date ?? ''),
      abstract: r.abstract ? String(r.abstract) : undefined,
      htmlUrl: r.html_url ? String(r.html_url) : undefined,
    }))
  } catch (err) {
    console.warn('[raw-signals/federal-register] query failed:', err instanceof Error ? err.message : err)
    return []
  }
}

const HAIKU_SYSTEM = `You assess Federal Register articles against a news story.
Given the story and recent rules/notices touching cluster entities, return:
- articlesRelevant: count that are truly about the story's subject
- materialRules: count of "Rule" or "Proposed Rule" type (i.e., actual regulatory action, not notices)
- narrativeGap: true if a material rule is absent from the story coverage
- gapDescription: 1-2 sentences or empty
Return JSON only:
{ "articlesRelevant": 0, "materialRules": 0, "narrativeGap": false, "gapDescription": "" }`

export const federalRegisterRunner: IntegrationRunner = async (ctx) => {
  if (ctx.scope !== 'cluster') return null
  const { cluster } = ctx
  if (!cluster.entities.length) {
    return {
      rawContent: { note: 'No entities' }, haikuSummary: 'Skipped — no entities',
      signalSource: 'federal-register', captureDate: new Date(), coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  const articles = await searchArticles(cluster.entities, cluster.firstDetectedAt)

  if (articles.length === 0) {
    return {
      rawContent: { query: { entities: cluster.entities.slice(0, 3) }, articles: [] },
      haikuSummary: 'No Federal Register entries in 90-day window.',
      signalSource: 'federal-register', captureDate: cluster.firstDetectedAt, coordinates: null,
      divergenceFlag: false, divergenceDescription: null, confidenceLevel: 'low' as const,
    }
  }

  let assessment = { articlesRelevant: 0, materialRules: 0, narrativeGap: false, gapDescription: '' }
  let haikuCost = 0
  try {
    const r = await callClaude({
      model: HAIKU, systemPrompt: HAIKU_SYSTEM,
      userPrompt: `Story: ${cluster.headline}\n\nSummary: ${cluster.synopsis.substring(0, 1200)}\n\nEntities: ${cluster.entities.slice(0, 6).join(', ')}\n\nFederal Register articles:\n${articles.slice(0, 12).map((a, i) => `${i + 1}. [${a.type}] ${a.title} | ${a.agencies.slice(0, 2).join('; ')} | ${a.publicationDate}`).join('\n')}`,
      agentType: 'raw_signal_federal_register', maxTokens: 500,
    })
    haikuCost = r.costUsd
    assessment = parseJSON(r.text)
  } catch (err) {
    console.warn('[raw-signals/federal-register] Haiku failed:', err instanceof Error ? err.message : err)
  }

  const divergenceFlag = assessment.materialRules > 0 && assessment.narrativeGap

  return {
    rawContent: { articles: articles.slice(0, 12), assessment, haikuCostUsd: haikuCost },
    haikuSummary: `${assessment.articlesRelevant} relevant entries (${assessment.materialRules} material rules)`,
    signalSource: 'federal-register', captureDate: cluster.firstDetectedAt, coordinates: null,
    divergenceFlag,
    divergenceDescription: divergenceFlag ? assessment.gapDescription : null,
    confidenceLevel: assessment.materialRules >= 2 ? 'high' : assessment.articlesRelevant >= 1 ? 'medium' : 'low',
  }
}
