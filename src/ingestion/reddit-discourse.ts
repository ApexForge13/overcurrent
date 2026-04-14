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

/**
 * Filter Reddit posts by keyword relevance.
 * Strict: post must match 2+ keywords. Falls back to 1-keyword if <3 posts pass strict.
 */
export function filterByKeywordRelevance(
  posts: RedditDiscoursePost[],
  keywords: string[],
): RedditDiscoursePost[] {
  const lowerKeywords = keywords.map(k => k.toLowerCase())
  const relevantPosts = posts.filter(post => {
    const text = post.content.toLowerCase()
    const matchCount = lowerKeywords.filter(kw => text.includes(kw)).length
    return matchCount >= 2
  })

  // Fall back to 1-keyword match if 2-keyword filter is too strict
  return relevantPosts.length >= 3
    ? relevantPosts
    : posts.filter(post => {
        const text = post.content.toLowerCase()
        return lowerKeywords.some(kw => text.includes(kw))
      })
}

// ── Subreddit allowlists ───────────────────────────────────────────────
// Always searched for every story:
const ALWAYS_SUBS = ['worldnews', 'politics', 'news', 'geopolitics']

// Added based on story category:
const CATEGORY_SUBS: Record<string, string[]> = {
  conflict: ['CredibleDefense', 'foreignpolicy'],
  politics: ['PoliticalDiscussion', 'NeutralPolitics', 'Conservative'],
  economy:  ['economics', 'wallstreetbets'],
  tech:     ['technology', 'artificial', 'MachineLearning'],
  labor:    ['antiwork', 'WorkReform'],
  climate:  ['climate', 'environment'],
  health:   ['health', 'science'],
  society:  ['TrueReddit', 'changemyview', 'OutOfTheLoop'],
  trade:    ['economics', 'geopolitics'],
}

export async function fetchRedditDiscourse(
  keywords: string[],
  category?: string,
  maxPosts: number = 10,
  minUpvotes: number = 25,
  storyDate?: Date,
): Promise<RedditDiscoursePost[]> {
  // Build subreddit list: always subs + category-specific
  const categorySubs = category && CATEGORY_SUBS[category]
    ? CATEGORY_SUBS[category]
    : []
  const subs = [...new Set([...ALWAYS_SUBS, ...categorySubs])]

  const allPosts: RedditDiscoursePost[] = []
  const seenUrls = new Set<string>()
  // Crosspost dedup: track external URLs (articles linked) to keep highest-upvoted
  const seenExternalUrls = new Map<string, number>() // externalUrl → index in allPosts

  // Build query with OR operators for better Reddit search relevance
  const query = keywords.slice(0, 8).join(' OR ')

  for (const sub of subs) {
    try {
      await sleep(2000) // Reddit rate limit

      const params = new URLSearchParams({
        q: query,
        sort: 'relevance',    // Relevance first, not top
        t: 'week',            // 72h window (Reddit API: "day" = 24h, "week" = 7d — closest to 72h)
        limit: '20',          // 20 results per subreddit
        restrict_sr: 'true',  // Only search within this subreddit
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

        // Crosspost/repost dedup: if same external URL, keep highest-upvoted
        const externalUrl = post.url && !post.url.includes('reddit.com') ? post.url : null
        if (externalUrl) {
          const existingIdx = seenExternalUrls.get(externalUrl)
          if (existingIdx !== undefined) {
            // Keep the one with more upvotes
            if (allPosts[existingIdx] && post.ups > allPosts[existingIdx].upvotes) {
              allPosts.splice(existingIdx, 1) // Remove lower-upvoted dupe
            } else {
              continue // Existing has more upvotes, skip this one
            }
          }
        }

        // Fetch top 5 comments (public sentiment lives here)
        let topComments: Array<{ text: string; upvotes: number }> = []
        try {
          await sleep(2000)
          const commentsResp = await fetch(
            `https://www.reddit.com${permalink}.json?sort=top&limit=7`,
            { headers: { 'User-Agent': 'Overcurrent/1.0' } },
          )
          if (commentsResp.ok) {
            const commentsData = await commentsResp.json()
            const commentChildren = commentsData?.[1]?.data?.children
            if (Array.isArray(commentChildren)) {
              topComments = commentChildren
                .filter((c: { kind: string; data?: { body?: string; ups?: number } }) => c.kind === 't1' && c.data?.body)
                .slice(0, 5)
                .map((c: { data: { body: string; ups: number } }) => ({
                  text: c.data.body.substring(0, 500),
                  upvotes: c.data.ups || 0,
                }))
            }
          }
        } catch {
          // Skip comment fetching errors
        }

        const postObj: RedditDiscoursePost = {
          platform: 'reddit',
          url,
          author: String(post.author ?? ''),
          subreddit: sub,
          content: `${post.title || ''}${post.selftext ? '\n' + post.selftext.substring(0, 1000) : ''}`,
          upvotes: post.ups || 0,
          comments: post.num_comments || 0,
          createdUtc: post.created_utc || 0,
          topComments,
        }

        const postIdx = allPosts.push(postObj) - 1
        if (externalUrl) {
          seenExternalUrls.set(externalUrl, postIdx)
        }
      }
    } catch {
      // Skip subreddit errors
    }
  }

  // ── KEYWORD RELEVANCE FILTER ─────────────────────────────────────────
  const filteredByKeyword = filterByKeywordRelevance(allPosts, keywords)

  // ── TEMPORAL RELEVANCE FILTER ──────────────────────────────────────
  // Only include posts within 72hr of the story (24hr before, 48hr after).
  // Posts outside the window go to "prior related discussion" category.
  if (storyDate) {
    const windowStart = new Date(storyDate.getTime() - 24 * 60 * 60 * 1000) // 24hr before
    const windowEnd = new Date(storyDate.getTime() + 48 * 60 * 60 * 1000)   // 48hr after

    const inWindow: RedditDiscoursePost[] = []
    const outsideWindow: RedditDiscoursePost[] = []

    for (const post of filteredByKeyword) {
      const postDate = new Date(post.createdUtc * 1000)
      if (postDate >= windowStart && postDate <= windowEnd) {
        inWindow.push(post)
      } else {
        outsideWindow.push(post)
      }
    }

    console.log(`[Reddit] Temporal filter: ${filteredByKeyword.length} posts → ${inWindow.length} in window, ${outsideWindow.length} outside 72hr window`)

    // If temporal filter is too aggressive, supplement with recent outside-window posts
    const finalPosts = inWindow.length >= 3
      ? inWindow
      : [...inWindow, ...outsideWindow.sort((a, b) => b.upvotes - a.upvotes).slice(0, 3 - inWindow.length)]

    return finalPosts
      .sort((a, b) => b.upvotes - a.upvotes)
      .slice(0, maxPosts)
  }

  return filteredByKeyword
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, maxPosts)
}
