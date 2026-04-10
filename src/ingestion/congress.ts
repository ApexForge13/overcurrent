import { fetchWithTimeout } from '@/lib/utils'

export interface CongressAction {
  billNumber: string
  title: string
  actionType: string
  actionDate: string
  chamber: string
  url: string
}

const CONGRESS_BASE = 'https://api.congress.gov/v3/bill'

/**
 * Fetch recent congressional actions (bills) within a date range.
 * Requires CONGRESS_API_KEY environment variable.
 * Returns empty array if no API key is configured (graceful degradation).
 */
export async function getCongressionalActions(
  startDate: string,
  endDate: string,
): Promise<CongressAction[]> {
  const apiKey = process.env.CONGRESS_API_KEY
  if (!apiKey) return []

  try {
    const params = new URLSearchParams({
      fromDateTime: `${startDate}T00:00:00Z`,
      toDateTime: `${endDate}T23:59:59Z`,
      limit: '50',
      api_key: apiKey,
    })

    const url = `${CONGRESS_BASE}?${params.toString()}`
    const response = await fetchWithTimeout(url)
    if (!response.ok) return []

    const data = await response.json()
    const bills = data?.bills
    if (!Array.isArray(bills)) return []

    const results: CongressAction[] = []

    for (const bill of bills) {
      const latestAction = bill.latestAction
      if (!latestAction) continue

      const actionText = String(latestAction.text ?? '')
      const actionDate = String(latestAction.actionDate ?? '')

      const billNumber = `${bill.type ?? ''}${bill.number ?? ''}`
      const chamber = bill.originChamber ?? bill.chamber ?? ''

      results.push({
        billNumber,
        title: String(bill.title ?? ''),
        actionType: actionText,
        actionDate,
        chamber: String(chamber),
        url: String(
          bill.url ??
            `https://www.congress.gov/bill/${bill.congress}/${billNumber}`,
        ),
      })
    }

    return results
  } catch {
    return []
  }
}
