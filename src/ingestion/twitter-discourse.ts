import { sleep } from '@/lib/utils'

export interface TwitterDiscoursePost {
  platform: 'twitter'
  url: string
  author: string
  authorFollowers: number
  isVerified: boolean
  content: string
  hashtags: string[]
  likes: number
  retweets: number
  replies: number
  views: number
  createdAt: string
}

export async function fetchTwitterDiscourse(
  keywords: string[],
  maxPosts: number = 10,
  minEngagement: number = 1000,
): Promise<TwitterDiscoursePost[]> {
  const token = process.env.TWITTER_BEARER_TOKEN
  if (!token) {
    // Twitter API not configured — skip silently
    return []
  }

  try {
    const query = keywords.slice(0, 5).join(' ')
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxPosts}&tweet.fields=public_metrics,author_id,created_at&expansions=author_id&user.fields=verified,public_metrics`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      console.warn('[Twitter] API error:', response.status)
      return []
    }

    const data = await response.json()
    const tweets = data.data || []
    const users = new Map((data.includes?.users || []).map((u: { id: string; username: string; verified?: boolean; public_metrics?: { followers_count: number } }) => [u.id, u]))

    return tweets
      .filter((t: { public_metrics?: { like_count: number; retweet_count: number } }) => {
        const engagement = (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0)
        return engagement >= minEngagement
      })
      .map((t: { id: string; text: string; author_id: string; created_at: string; public_metrics: { like_count: number; retweet_count: number; reply_count: number; impression_count: number } }) => {
        const user = users.get(t.author_id) as { username: string; verified?: boolean; public_metrics?: { followers_count: number } } | undefined
        return {
          platform: 'twitter' as const,
          url: `https://twitter.com/i/web/status/${t.id}`,
          author: user?.username || '',
          authorFollowers: user?.public_metrics?.followers_count || 0,
          isVerified: user?.verified || false,
          content: t.text,
          hashtags: (t.text.match(/#\w+/g) || []),
          likes: t.public_metrics?.like_count || 0,
          retweets: t.public_metrics?.retweet_count || 0,
          replies: t.public_metrics?.reply_count || 0,
          views: t.public_metrics?.impression_count || 0,
          createdAt: t.created_at || '',
        }
      })
      .slice(0, maxPosts)
  } catch (err) {
    console.warn('[Twitter] Fetch error:', err)
    return []
  }
}
