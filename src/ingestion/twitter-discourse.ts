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

// Known news outlet handles — these belong in Stream 1, not social discourse
const NEWS_OUTLET_HANDLES = new Set([
  'nytimes', 'washingtonpost', 'baborea', 'reuters', 'ap', 'afp',
  'baborea', 'caborea', 'bbcworld', 'bbcnews', 'caborea',
  'cnn', 'foxnews', 'msnbc', 'abcnews', 'cbsnews', 'nbcnews',
  'guardian', 'telegraph', 'ft', 'economist', 'wsj',
  'alaborea', 'scaborea', 'nhk_world', 'xinhua',
])

export async function fetchTwitterDiscourse(
  keywords: string[],
  maxPosts: number = 10,
  minLikes: number = 100,
): Promise<TwitterDiscoursePost[]> {
  const token = process.env.TWITTER_BEARER_TOKEN
  if (!token) {
    return []
  }

  try {
    // Build query with OR operators per spec:
    // (keyword1 OR keyword2 OR keyword3) -is:retweet lang:en
    const topKeywords = keywords.slice(0, 8)
    const queryTerms = topKeywords.map(k => k.replace(/[()]/g, '')).join(' OR ')
    const fullQuery = `(${queryTerms}) -is:retweet lang:en`

    const params = new URLSearchParams({
      query: fullQuery,
      max_results: '100',   // Pull up to 100, then filter down
      'tweet.fields': 'public_metrics,author_id,created_at',
      expansions: 'author_id',
      'user.fields': 'verified,public_metrics,username',
    })

    const response = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (!response.ok) {
      console.warn('[Twitter] API error:', response.status)
      return []
    }

    const data = await response.json()
    const tweets = data.data || []
    const users = new Map(
      (data.includes?.users || []).map(
        (u: { id: string; username: string; verified?: boolean; public_metrics?: { followers_count: number } }) =>
          [u.id, u],
      ),
    )

    const processed: TwitterDiscoursePost[] = tweets
      .map((t: {
        id: string
        text: string
        author_id: string
        created_at: string
        public_metrics: {
          like_count: number
          retweet_count: number
          reply_count: number
          impression_count: number
          quote_count?: number
        }
      }) => {
        const user = users.get(t.author_id) as {
          username: string
          verified?: boolean
          public_metrics?: { followers_count: number }
        } | undefined

        const likes = t.public_metrics?.like_count || 0
        const retweets = t.public_metrics?.retweet_count || 0
        const username = user?.username || ''
        const followers = user?.public_metrics?.followers_count || 0
        const verified = user?.verified || false

        return {
          platform: 'twitter' as const,
          url: `https://x.com/${username}/status/${t.id}`,
          author: username,
          authorFollowers: followers,
          isVerified: verified,
          content: t.text,
          hashtags: (t.text.match(/#\w+/g) || []),
          likes,
          retweets,
          replies: t.public_metrics?.reply_count || 0,
          views: t.public_metrics?.impression_count || 0,
          createdAt: t.created_at || '',
          _engagement: likes + retweets, // internal sorting field
        }
      })
      // Filter: minimum 100 likes
      .filter((t: { likes: number }) => t.likes >= minLikes)
      // Filter: reject news outlet official accounts
      .filter((t: { author: string }) => !NEWS_OUTLET_HANDLES.has(t.author.toLowerCase()))
      // Filter: reject tweets that are just a link with no commentary
      .filter((t: { content: string }) => {
        // Remove URLs from text, check if meaningful content remains
        const textWithoutUrls = t.content.replace(/https?:\/\/\S+/g, '').trim()
        return textWithoutUrls.length >= 30
      })
      // Sort by total engagement descending
      .sort((a: { _engagement: number }, b: { _engagement: number }) => b._engagement - a._engagement)
      // Take top posts
      .slice(0, maxPosts)
      // Clean up internal field
      .map((t: { _engagement: number } & TwitterDiscoursePost) => {
        const { _engagement: _, ...post } = t
        return post
      })

    return processed
  } catch (err) {
    console.warn('[Twitter] Fetch error:', err)
    return []
  }
}
