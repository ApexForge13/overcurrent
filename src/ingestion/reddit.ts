import { fetchWithTimeout } from '@/lib/utils'

export interface RedditResult {
  url: string
  title: string
  subreddit: string
  score: number
  numComments: number
  selftext?: string
  createdUtc: number
}

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json'

/**
 * Search Reddit for posts matching the query.
 * Uses Reddit's public JSON API (no auth required).
 */
export async function searchReddit(
  query: string,
): Promise<RedditResult[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      sort: 'relevance',
      t: 'week',
      limit: '25',
    })

    const url = `${REDDIT_SEARCH_URL}?${params.toString()}`

    // Reddit requires a User-Agent; fetchWithTimeout doesn't support headers,
    // so we use fetch directly with an AbortController for timeout.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Overcurrent/1.0',
        },
      })

      if (!response.ok) return []

      const data = await response.json()
      const children = data?.data?.children
      if (!Array.isArray(children)) return []

      return children.map(
        (child: { data: Record<string, unknown> }) => {
          const d = child.data
          const isSelfPost = !!d.selftext
          const permalink = String(d.permalink ?? '')

          return {
            url: isSelfPost
              ? `https://reddit.com${permalink}`
              : String(d.url ?? ''),
            title: String(d.title ?? ''),
            subreddit: String(d.subreddit ?? ''),
            score: Number(d.score ?? 0),
            numComments: Number(d.num_comments ?? 0),
            selftext: d.selftext ? String(d.selftext) : undefined,
            createdUtc: Number(d.created_utc ?? 0),
          }
        },
      )
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    return []
  }
}
