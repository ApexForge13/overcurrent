import { sleep } from '@/lib/utils'

export interface RedditDiscoursePost {
  platform: 'reddit'
  url: string
  author: string
  subreddit: string
  content: string
  upvotes: number
  comments: number
  createdUtc: number
  topComments: Array<{ text: string; upvotes: number }>
}

const REDDIT_SUBS_BY_CATEGORY: Record<string, string[]> = {
  conflict:  ['worldnews', 'geopolitics', 'CredibleDefense'],
  politics:  ['politics', 'PoliticalDiscussion', 'NeutralPolitics', 'Conservative'],
  economy:   ['economics', 'finance', 'wallstreetbets', 'stocks'],
  tech:      ['technology', 'artificial', 'MachineLearning'],
  labor:     ['antiwork', 'WorkReform', 'lostgeneration', 'povertyfinance'],
  climate:   ['climate', 'environment', 'energy'],
  health:    ['health', 'science', 'medicine'],
  society:   ['TrueReddit', 'FoodForThought', 'changemyview', 'OutOfTheLoop'],
  trade:     ['economics', 'geopolitics'],
  general:   ['news', 'worldnews', 'OutOfTheLoop'],
}

export async function fetchRedditDiscourse(
  keywords: string[],
  category?: string,
  maxPosts: number = 15,
  minUpvotes: number = 50,
): Promise<RedditDiscoursePost[]> {
  const subs = category && REDDIT_SUBS_BY_CATEGORY[category]
    ? REDDIT_SUBS_BY_CATEGORY[category]
    : REDDIT_SUBS_BY_CATEGORY.general

  const allPosts: RedditDiscoursePost[] = []
  const seenUrls = new Set<string>()
  const query = keywords.join(' ')

  for (const sub of subs) {
    try {
      await sleep(2000) // Reddit rate limit

      const params = new URLSearchParams({
        q: query,
        sort: 'top',
        t: 'week',
        limit: '10',
      })

      const response = await fetch(
        `https://www.reddit.com/r/${sub}/search.json?${params}`,
        { headers: { 'User-Agent': 'Overcurrent/1.0' } },
      )

      if (!response.ok) continue
      const data = await response.json()
      const children = data?.data?.children
      if (!Array.isArray(children)) continue

      for (const child of children) {
        const post = child.data
        if (!post || post.ups < minUpvotes) continue

        const permalink = post.permalink
        const url = `https://www.reddit.com${permalink}`
        if (seenUrls.has(url)) continue
        seenUrls.add(url)

        // Fetch top comments
        let topComments: Array<{ text: string; upvotes: number }> = []
        try {
          await sleep(2000)
          const commentsResp = await fetch(
            `https://www.reddit.com${permalink}.json?sort=top&limit=5`,
            { headers: { 'User-Agent': 'Overcurrent/1.0' } },
          )
          if (commentsResp.ok) {
            const commentsData = await commentsResp.json()
            const commentChildren = commentsData?.[1]?.data?.children
            if (Array.isArray(commentChildren)) {
              topComments = commentChildren
                .filter((c: { kind: string; data?: { body?: string; ups?: number } }) => c.kind === 't1' && c.data?.body)
                .slice(0, 3)
                .map((c: { data: { body: string; ups: number } }) => ({
                  text: c.data.body.substring(0, 500),
                  upvotes: c.data.ups || 0,
                }))
            }
          }
        } catch {
          // Skip comment fetching errors
        }

        allPosts.push({
          platform: 'reddit',
          url,
          author: String(post.author ?? ''),
          subreddit: sub,
          content: `${post.title || ''}${post.selftext ? '\n' + post.selftext.substring(0, 1000) : ''}`,
          upvotes: post.ups || 0,
          comments: post.num_comments || 0,
          createdUtc: post.created_utc || 0,
          topComments,
        })
      }
    } catch {
      // Skip subreddit errors
    }
  }

  return allPosts
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, maxPosts)
}
