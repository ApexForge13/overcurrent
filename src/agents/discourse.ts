import { callModel, parseJSON } from '@/lib/models'
import { JSON_RULES } from './prompts'
import type { RedditDiscoursePost } from '@/ingestion/reddit-discourse'
import type { TwitterDiscoursePost } from '@/ingestion/twitter-discourse'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Union type for all social posts fed into discourse analysis */
export type SocialPost =
  | RedditDiscoursePost
  | TwitterDiscoursePost

export interface DiscourseAnalysis {
  posts: Array<{
    post_index: number
    platform: string
    framing_type: string
    sentiment: string
    key_quote: string
  }>
  aggregate: {
    dominant_framing: string
    dominant_framing_pct: number
    secondary_framing: string
    secondary_framing_pct: number
    dominant_sentiment: string
    total_engagement: number
    post_count: number
  }
  gap: {
    media_dominant_frame: string
    media_frame_pct: number
    public_dominant_frame: string
    public_frame_pct: number
    gap_score: number
    gap_direction: string
    gap_summary: string
    public_surfaced_first: Array<{ insight: string; platform: string }>
    media_ignored_by_public: string[]
    public_counter_narrative: string
  }
  costUsd: number
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are analyzing the gap between news media coverage and public discourse on social media.

You receive:
1. A summary of how news outlets covered a story (framing, key claims, omissions)
2. Relevant Reddit posts and top comments
3. Relevant Twitter/X posts

Your job:
- Identify what the public is discussing that media is NOT covering
- Identify what media is reporting that the public is ignoring
- Score the gap from 0-100:
  0 = media and public are aligned
  50 = moderate divergence in emphasis
  100 = completely opposed narratives
- Classify the gap type: "aligned", "divergent", "opposed", "public_leads", "media_leads"
- Extract the dominant counter-narrative from social media
- Label each social insight with which platform it came from (Reddit or Twitter/X)

Rules:
- Never mix social media findings into the news analysis
- Never treat upvotes/likes as evidence of factual accuracy
- Social media sentiment is OPINION data, not verification data
- Flag any social media claims that contradict verified news reporting
- If social media surfaces a fact that news hasn't reported, flag it as "social_first" but do NOT elevate it to verified status

For each post, classify:
- framingType: crime | labor | financial | solidarity | outrage | humor | skepticism | conspiracy | indifference | counter_narrative | other
- sentiment: positive | negative | neutral | mixed
- platform: "reddit" or "twitter"

${JSON_RULES}

{
  "posts": [
    { "post_index": 0, "platform": "reddit", "framing_type": "outrage", "sentiment": "negative", "key_quote": "..." },
    { "post_index": 1, "platform": "twitter", "framing_type": "skepticism", "sentiment": "mixed", "key_quote": "..." }
  ],
  "aggregate": {
    "dominant_framing": "outrage",
    "dominant_framing_pct": 65,
    "secondary_framing": "skepticism",
    "secondary_framing_pct": 20,
    "dominant_sentiment": "negative",
    "total_engagement": 450000,
    "post_count": 18
  },
  "gap": {
    "media_dominant_frame": "military/economic",
    "media_frame_pct": 85,
    "public_dominant_frame": "outrage",
    "public_frame_pct": 65,
    "gap_score": 78,
    "gap_direction": "opposed",
    "gap_summary": "Media focused on logistics and economics while public expressed outrage at perceived policy contradictions.",
    "public_surfaced_first": [
      { "insight": "Timing manipulation for Monday markets", "platform": "twitter" },
      { "insight": "Genocide language comparison to previous admin", "platform": "reddit" }
    ],
    "media_ignored_by_public": ["Delegation composition details", "Specific oil price data"],
    "public_counter_narrative": "The public questions how blocking a strait can be framed as opening diplomatic channels."
  }
}`

// ---------------------------------------------------------------------------
// Post formatter — handles both platforms
// ---------------------------------------------------------------------------

function formatPost(post: SocialPost, index: number): string {
  if (post.platform === 'reddit') {
    const p = post as RedditDiscoursePost
    const commentsStr = p.topComments.length > 0
      ? `\nTop comments: ${p.topComments.map(c => `"${c.text.substring(0, 200)}" (${c.upvotes} upvotes)`).join(' | ')}`
      : ''
    return `[${index}] REDDIT · r/${p.subreddit} · ${p.upvotes} upvotes · ${p.comments} comments\n${p.content}${commentsStr}`
  } else {
    const p = post as TwitterDiscoursePost
    return `[${index}] TWITTER/X · @${p.author} · ${p.likes} likes · ${p.retweets} RTs · ${p.views} views\n${p.content}`
  }
}

// ---------------------------------------------------------------------------
// Agent function
// ---------------------------------------------------------------------------

export async function analyzeDiscourse(
  mediaSummary: { headline: string; dominantFraming: string; framingPct: number; claims: string[] },
  socialPosts: SocialPost[],
  storyId?: string,
): Promise<DiscourseAnalysis> {
  const redditCount = socialPosts.filter(p => p.platform === 'reddit').length
  const twitterCount = socialPosts.filter(p => p.platform === 'twitter').length

  const postsText = socialPosts
    .map((p, i) => formatPost(p, i))
    .join('\n\n---\n\n')

  const userPrompt = `MEDIA ANALYSIS SUMMARY:
Headline: ${mediaSummary.headline}
Dominant media framing: ${mediaSummary.dominantFraming} (${mediaSummary.framingPct}% of outlets)
Key claims: ${mediaSummary.claims.join('; ')}

SOCIAL MEDIA POSTS (${socialPosts.length} total: ${redditCount} Reddit + ${twitterCount} Twitter/X):

${postsText}`

  const result = await callModel({
    provider: 'anthropic',
    tier: 'fast', // Haiku — cheap
    system: SYSTEM_PROMPT,
    userMessage: userPrompt,
    maxTokens: 4096,
    agentType: 'discourse',
    storyId,
  })

  const parsed = parseJSON<Omit<DiscourseAnalysis, 'costUsd'>>(result.text)

  return {
    posts: (parsed.posts ?? []).map(p => ({
      post_index: p.post_index ?? 0,
      platform: p.platform ?? 'reddit',
      framing_type: p.framing_type ?? 'other',
      sentiment: p.sentiment ?? 'neutral',
      key_quote: p.key_quote ?? '',
    })),
    aggregate: parsed.aggregate ?? {
      dominant_framing: 'unknown',
      dominant_framing_pct: 0,
      secondary_framing: 'unknown',
      secondary_framing_pct: 0,
      dominant_sentiment: 'unknown',
      total_engagement: 0,
      post_count: 0,
    },
    gap: {
      media_dominant_frame: parsed.gap?.media_dominant_frame ?? mediaSummary.dominantFraming,
      media_frame_pct: parsed.gap?.media_frame_pct ?? mediaSummary.framingPct,
      public_dominant_frame: parsed.gap?.public_dominant_frame ?? 'unknown',
      public_frame_pct: parsed.gap?.public_frame_pct ?? 0,
      gap_score: parsed.gap?.gap_score ?? 0,
      gap_direction: parsed.gap?.gap_direction ?? 'aligned',
      gap_summary: parsed.gap?.gap_summary ?? 'Insufficient social data to measure gap.',
      public_surfaced_first: Array.isArray(parsed.gap?.public_surfaced_first)
        ? parsed.gap.public_surfaced_first.map((item: string | { insight: string; platform: string }) =>
            typeof item === 'string' ? { insight: item, platform: 'reddit' } : item
          )
        : [],
      media_ignored_by_public: Array.isArray(parsed.gap?.media_ignored_by_public) ? parsed.gap.media_ignored_by_public : [],
      public_counter_narrative: parsed.gap?.public_counter_narrative ?? '',
    },
    costUsd: result.costUsd,
  }
}
