import { fetchWithTimeout } from '@/lib/utils'

export interface FedRegAction {
  title: string
  type: string
  agencies: string[]
  publicationDate: string
  abstract: string
  htmlUrl: string
  documentNumber: string
}

const FED_REG_BASE = 'https://www.federalregister.gov/api/v1/documents.json'

/**
 * Fetch federal register actions (rules, proposed rules, presidential documents)
 * within a date range. No authentication required.
 */
export async function getFederalRegisterActions(
  startDate: string,
  endDate: string,
): Promise<FedRegAction[]> {
  try {
    // Build URL manually because URLSearchParams doesn't handle
    // duplicate keys (conditions[type][]) properly
    const url =
      `${FED_REG_BASE}?` +
      `conditions[publication_date][gte]=${encodeURIComponent(startDate)}` +
      `&conditions[publication_date][lte]=${encodeURIComponent(endDate)}` +
      `&conditions[type][]=RULE` +
      `&conditions[type][]=PRORULE` +
      `&conditions[type][]=PRESDOCU` +
      `&per_page=50`

    const response = await fetchWithTimeout(url)
    if (!response.ok) return []

    const data = await response.json()
    const results = data?.results
    if (!Array.isArray(results)) return []

    return results.map((doc: Record<string, unknown>) => {
      const agencies = Array.isArray(doc.agencies)
        ? (doc.agencies as Array<{ name?: string }>).map((a) =>
            String(a.name ?? ''),
          )
        : []

      return {
        title: String(doc.title ?? ''),
        type: String(doc.type ?? ''),
        agencies,
        publicationDate: String(doc.publication_date ?? ''),
        abstract: String(doc.abstract ?? ''),
        htmlUrl: String(doc.html_url ?? ''),
        documentNumber: String(doc.document_number ?? ''),
      }
    })
  } catch {
    return []
  }
}
