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
  minLikes: number = 10,
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
      max_results: '100',
      sort_order: 'relevancy', // Surface engaged tweets, not just chronological
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

    // Map all tweets to typed objects first for staged filtering
    type MappedTweet = TwitterDiscoursePost & { _engagement: number }
    const mapped: MappedTweet[] = tweets.map((t: {
      id: string; text: string; author_id: string; created_at: string
      public_metrics: { like_count: number; retweet_count: number; reply_count: number; impression_count: number; quote_count?: number }
    }) => {
      const user = users.get(t.author_id) as {
        username: string; verified?: boolean; public_metrics?: { followers_count: number }
      } | undefined
      const likes = t.public_metrics?.like_count || 0
      const retweets = t.public_metrics?.retweet_count || 0
      return {
        platform: 'twitter' as const,
        url: `https://x.com/${user?.username || 'i'}/status/${t.id}`,
        author: user?.username || '',
        authorFollowers: user?.public_metrics?.followers_count || 0,
        isVerified: user?.verified || false,
        content: t.text,
        hashtags: (t.text.match(/#\w+/g) || []),
        likes, retweets,
        replies: t.public_metrics?.reply_count || 0,
        views: t.public_metrics?.impression_count || 0,
        createdAt: t.created_at || '',
        _engagement: likes + retweets,
      }
    })

    // Staged filtering with per-stage counts
    const afterLikes = mapped.filter(t => t.likes >= minLikes)
    const afterOutlet = afterLikes.filter(t => !NEWS_OUTLET_HANDLES.has(t.author.toLowerCase()))
    const afterText = afterOutlet.filter(t => {
      const textWithoutUrls = t.content.replace(/https?:\/\/\S+/g, '').trim()
      return textWithoutUrls.length >= 20
    })
    const afterKeyword = afterText.filter(t => {
      const lower = t.content.toLowerCase()
      return storyTerms.some(kw => lower.includes(kw.toLowerCase()))
    })

    const processed: TwitterDiscoursePost[] = afterKeyword
      .sort((a, b) => b._engagement - a._engagement)
      .slice(0, maxPosts)
      .map(({ _engagement: _, ...post }) => post)

    console.log(`[Twitter] Funnel: ${tweets.length} raw → ${afterLikes.length} with ${minLikes}+ likes → ${afterOutlet.length} after outlet filter → ${afterText.length} after text filter → ${afterKeyword.length} after keyword filter → ${processed.length} final`)

    // If fewer than 3 tweets survived, supplement with top engagement tweets
    if (processed.length < 3 && tweets.length > 0) {
      const need = 5 - processed.length
      console.log(`[Twitter] Only ${processed.length} tweets — supplementing with top ${need} by engagement`)
      const existingUrls = new Set(processed.map(p => p.url))
      const supplement: TwitterDiscoursePost[] = tweets
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
        .filter((t: TwitterDiscoursePost) => !existingUrls.has(t.url) && !NEWS_OUTLET_HANDLES.has(t.author.toLowerCase()))
        .sort((a: { likes: number; retweets: number }, b: { likes: number; retweets: number }) => (b.likes + b.retweets) - (a.likes + a.retweets))
        .slice(0, need)
      processed.push(...supplement)
    }

    return processed
  } catch (err) {
    console.warn('[Twitter] Fetch error:', err)
    return []
  }
}
