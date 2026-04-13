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
  'nytimes', 'washingtonpost', 'reuters', 'ap', 'afp',
  'bbcworld', 'bbcnews', 'bbcbreaking',
  'cnn', 'foxnews', 'msnbc', 'abcnews', 'cbsnews', 'nbcnews',
  'guardian', 'telegraph', 'ft', 'economist', 'wsj',
  'aljazeera', 'aaborea', 'nhk_world', 'xinaborea',
  'axios', 'thehill', 'politico', 'npr',
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
    // Build two-group query: (topic terms) (context terms) -is:retweet lang:en
    // First group requires at least one story-specific term.
    // Second group adds context. This prevents matching unrelated tweets.
    const storyTerms = keywords.filter(k => k.length > 3).slice(0, 5)
    const contextTerms = keywords.filter(k => k.length > 3).slice(5, 10)
    const group1 = storyTerms.map(k => k.replace(/[()]/g, '')).join(' OR ')
    const group2 = contextTerms.length > 0
      ? ` (${contextTerms.map(k => k.replace(/[()]/g, '')).join(' OR ')})`
      : ''
    const fullQuery = `(${group1})${group2} -is:retweet lang:en`
    console.log(`[Twitter] Query: ${fullQuery}`)

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

    console.log(`[Twitter] API returned ${tweets.length} tweets, ${users.size} users`)

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
      // Filter: minimum 50 likes (not 100 — too high for breaking news, not 10 — catches spam)
      .filter((t: { likes: number }) => t.likes >= minLikes)
      // Filter: reject news outlet official accounts
      .filter((t: { author: string }) => !NEWS_OUTLET_HANDLES.has(t.author.toLowerCase()))
      // Filter: reject tweets that are just a link with no commentary (>20 chars)
      .filter((t: { content: string }) => {
        const textWithoutUrls = t.content.replace(/https?:\/\/\S+/g, '').trim()
        return textWithoutUrls.length >= 20
      })
      // Filter: post-fetch relevance — tweet must contain at least 2 story keywords
      .filter((t: { content: string }) => {
        const lower = t.content.toLowerCase()
        const matches = storyTerms.filter(kw => lower.includes(kw.toLowerCase()))
        return matches.length >= 2
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

    console.log(`[Twitter] After filters: ${processed.length} tweets (from ${tweets.length} raw)`)

    // If all tweets got filtered, return top 5 by engagement regardless of threshold
    if (processed.length === 0 && tweets.length > 0) {
      console.log(`[Twitter] All tweets filtered — returning top 5 by engagement as fallback`)
      const fallback = tweets
        .map((t: { id: string; text: string; author_id: string; created_at: string; public_metrics: { like_count: number; retweet_count: number; reply_count: number; impression_count: number } }) => {
          const user = users.get(t.author_id) as { username: string; verified?: boolean; public_metrics?: { followers_count: number } } | undefined
          return {
            platform: 'twitter' as const,
            url: `https://x.com/${user?.username || 'i'}/status/${t.id}`,
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
        .sort((a: { likes: number; retweets: number }, b: { likes: number; retweets: number }) => (b.likes + b.retweets) - (a.likes + a.retweets))
        .slice(0, 5)
      return fallback
    }

    return processed
  } catch (err) {
    console.warn('[Twitter] Fetch error:', err)
    return []
  }
}
